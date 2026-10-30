import { admitObservation, isHttpUrl, isImageUrl, isLikelyAdMediaUrl, mediaFormatFor } from './classifier'
import { parseMediaApiBody } from './apiParser'
import type { MediaObservation } from './types'
import { regexMatches } from '../../lib/regexMatches'

const MAX_SCRIPT = 256 * 1024
const MAX_NODES = 2048

/** Read literal data only. Expressions/functions are skipped, never evaluated. */
export function readPlayerLiteral(input: string, offset = 0): unknown {
  const text = input.slice(offset, offset + MAX_SCRIPT)
  let pos = 0, nodes = 0
  const space = () => {
    while (pos < text.length) {
      if (/\s/.test(text[pos])) { pos++; continue }
      if (text.slice(pos,pos+2)==='//') { const end=text.indexOf('\n',pos+2);pos=end<0?text.length:end+1;continue }
      if (text.slice(pos,pos+2)==='/*') { const end=text.indexOf('*/',pos+2);pos=end<0?text.length:end+2;continue }
      break
    }
  }
  const string = (): string | undefined => {
    const quote=text[pos++];let result=''
    while(pos<text.length) {
      const char=text[pos++]
      if(char===quote)return result
      if(char!=='\\'){result+=char;continue}
      const escape=text[pos++]
      if(escape==='u'||escape==='x') {
        const length=escape==='u'?4:2, code=text.slice(pos,pos+length)
        if(!new RegExp(`^[0-9a-f]{${length}}$`,'i').test(code))return undefined
        result+=String.fromCharCode(parseInt(code,16));pos+=length
      } else {
        const escaped: Record<string,string>={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v'}
        if(escape!=='\n'&&escape!=='\r')result+=escaped[escape]??escape
      }
    }
    return undefined
  }
  const skip = () => {
    const stack:string[]=[]
    while(pos<text.length) {
      const char=text[pos]
      if(char==='"'||char==="'"||char==='`'){string();continue}
      if(!stack.length&&/[,}\]]/.test(char))return
      if(/[({[]/.test(char))stack.push(char)
      else if(/[)}\]]/.test(char))stack.pop()
      pos++
    }
  }
  const read=(depth:number):unknown=>{
    space();if(depth>12||++nodes>MAX_NODES){skip();return undefined}
    const char=text[pos]
    if(char==='"'||char==="'")return string()
    if(char==='{'||char==='[') {
      pos++;const array=char==='[',close=array?']':'}'
      const object:Record<string,unknown>=Object.create(null),list:unknown[]=[]
      while(pos<text.length&&nodes<=MAX_NODES) {
        space();if(text[pos]===close){pos++;return array?list:object}
        if(text[pos]===','){pos++;continue}
        const before=pos
        if(array){const value=read(depth+1);if(value!==undefined)list.push(value)}
        else {
          let key:string|undefined
          if(text[pos]==='"'||text[pos]==="'")key=string()
          else {const match=/^[\w$]+/.exec(text.slice(pos));if(match){key=match[0];pos+=key.length}}
          space()
          if(key&&text[pos]===':') {
            pos++;const value=read(depth+1)
            if(value!==undefined&&!['__proto__','constructor','prototype'].includes(key))object[key]=value
          } else skip()
        }
        space();if(text[pos]!==','&&text[pos]!==close)skip()
        if(pos===before)pos++
      }
      return array?list:object
    }
    const literal=/^(true|false|null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?=\s*[,}\]]|\s*$)/i.exec(text.slice(pos))
    if(literal){pos+=literal[0].length;try{return JSON.parse(literal[0])}catch{return undefined}}
    skip();return undefined
  }
  return read(0)
}

export interface PlayerDeclaration {
  url: string
  sourceLabel?: string
  framework: string
  observation?: MediaObservation
}

function record(value: unknown): Record<string,unknown> | undefined {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined
}

export function decodePlayerUrl(value: unknown, encoding: unknown = 0): string | undefined {
  if(typeof value!=='string'||!value.trim()||value.length>16384)return undefined
  let url=value.trim().replace(/&amp;/gi,'&').replace(/\\\//g,'/')
  try {
    if(Number(encoding)===2)url=atob(url.replace(/-/g,'+').replace(/_/g,'/'))
    if(Number(encoding)===1||Number(encoding)===2||/^https?%3a/i.test(url))url=decodeURIComponent(url)
  }catch{return undefined}
  return url
}

function cleanConfig(value: unknown, depth=0): unknown {
  if(depth>10)return undefined
  if(Array.isArray(value))return value.slice(0,48).map(item=>cleanConfig(item,depth+1))
  const object=record(value)
  if(!object)return value
  const result:Record<string,unknown>=Object.create(null)
  for(const [key,child]of Object.entries(object).slice(0,80)) {
    if(/^(?:url_next|next|nextUrl|next_url|playlist|recommendations?|related|ads?|advertising|poster|thumbnail|image|logo)$/i.test(key))continue
    result[key]=cleanConfig(child,depth+1)
  }
  return result
}

/** Primary/current configuration, not a regular-expression sweep of every URL on the page. */
export function playerDeclarationsInHtml(html: string,pageUrl: string): PlayerDeclaration[] {
  const result:PlayerDeclaration[]=[]
  const add=(raw:unknown,label:unknown,framework:string,mimeType?:string)=>{
    const decoded=decodePlayerUrl(raw)
    if(!decoded)return
    let url:string
    try{url=new URL(decoded,pageUrl).href}catch{return}
    if(!isHttpUrl(url)||isImageUrl(url)||isLikelyAdMediaUrl(url)||result.some(item=>item.url===url))return
    const sourceLabel=typeof label==='string'&&label.trim()?label.trim().slice(0,80):undefined
    const candidate:MediaObservation={source:'player-config',url,pageUrl,mimeType,sourceLabel}
    const format=mediaFormatFor(url,mimeType)
    const observation=format==='unknown'?undefined:admitObservation(candidate)??undefined
    result.push({url,sourceLabel,framework,observation})
  }
  const inspect=(value:unknown,framework:string)=>{
    const config=record(value);if(!config)return
    if(framework==='maccms') {
      add(decodePlayerUrl(config.url,config.encrypt),config.from||config.name,framework)
      return
    }
    const safe=cleanConfig(config)
    for(const item of parseMediaApiBody(JSON.stringify(safe),pageUrl,'static')) {
      add(item.url,item.quality||config.from||config.name,framework,item.mimeType)
      const last=result.find(entry=>entry.url===item.url)
      if(last?.observation)last.observation={...item,source:'player-config',sourceLabel:last.sourceLabel}
    }
    const object=record(safe)
    if(object)add(object.channel_key,object.name,framework)
  }
  const scripts=regexMatches(html, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
  // Callers that already extracted the script text need the same parser.
  const bodies=scripts.length?scripts.map(match=>({attrs:match[1],body:match[2]})):[{attrs:'',body:html}]
  for(const {attrs,body} of bodies.slice(0,96)) {
    if(body.length>MAX_SCRIPT)continue
    if(/application\/json/i.test(attrs)&&/\bid=["'][^"']*(?:player|playinfo)[^"']*["']/i.test(attrs)) {
      try{inspect(JSON.parse(body),'json-player')}catch{/* Runtime will handle nonliteral configurations. */}
    }
    const assignments=/\b(player_aaaa|player_data|playerData|HR_P2P|flashvars|flashVars|playerConfig|playerOptions|ytInitialPlayerResponse|__playinfo__)\s*=\s*/g
    for(const match of regexMatches(body, assignments)) {
      inspect(readPlayerLiteral(body,(match.index??0)+match[0].length),/^player_(?:aaaa|data)$|^playerData$/.test(match[1])?'maccms':match[1])
    }
    const constructors=/\bnew\s+(DPlayer|Artplayer|ArtPlayer|CKPlayer|ckplayer)\s*\(\s*|\bjwplayer\s*\([^)]{0,200}\)\s*\.setup\s*\(\s*/g
    for(const match of regexMatches(body, constructors))inspect(readPlayerLiteral(body,(match.index??0)+match[0].length),match[1]||'jwplayer')
    for(const match of regexMatches(body, /\bMacPlayer\.(?:PlayUrl|Url|url)\s*=\s*/g)) {
      const value=readPlayerLiteral(body,(match.index??0)+match[0].length)
      if(typeof value==='string'&&!value.includes('$$$')&&!/^[^$]+\$https?:/i.test(value))add(value,undefined,'maccms')
    }
  }
  return result.slice(0,64)
}
