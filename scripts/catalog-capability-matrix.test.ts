import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import { catalogSearchRequest } from '../src/features/siteCatalog/requests'
import { CMS_CAPABILITY_ADAPTERS } from '../src/features/siteCatalog/abilities/semantics'
import type { FrameworkId } from '../src/features/frameworkDetect/types'
import type { NewsSource } from '../src/sources/registry'

const source:NewsSource={id:'engine-matrix',name:'Matrix',label:'Matrix',url:'https://matrix.example/list/',group:'custom',kind:'web-catalog',enabled:true}
const card='<main><article><h2><a href="/posts/real">Real content</a></h2></article></main>'
const option=(name:string,label:string)=>`<label>${label}<select name="${name}"><option value="first" selected>First</option><option value="second">Second</option></select></label>`
type Case={engine:FrameworkId;identity:string;html:string;role:string;query?:string;method?:'GET'|'POST';next?:string}
// Independent rendered-structure prototypes. They exercise different contracts;
// they are not claims that every commercial theme of these CMS was visited live.
const cases:Case[]=[
 {engine:'maccms',identity:'<script>var maccms={};</script>',html:'<ul class="stui-screen__list"><li><strong>年份</strong><a href="/vodshow/1--------2025---.html">2025</a><a href="/vodshow/1--------2026---.html">2026</a></li></ul><form action="/vodsearch"><input name="wd"></form>',role:'year',query:'wd'},
 {engine:'seacms',identity:'<meta name="generator" content="SeaCMS">',html:'<dl><dt>地区</dt><dd><a href="?area=CN">中国</a><a href="?area=US">美国</a></dd></dl><form action="/search.php" method="post"><input name="searchword"></form>',role:'region',query:'searchword',method:'POST'},
 {engine:'fyfcms',identity:'<script>var feifei={};</script>',html:'<div><label>类型</label><a href="?mcid=1">动作</a><a href="?mcid=2">喜剧</a></div><form class="ff-search" data-action="/vod-search-wd-FFWD.html"><input name="wd"></form>',role:'genre'},
 {engine:'zanpian',identity:'<script>var zanpian={};</script>',html:'<div class="filter-list"><dl><dt>状态</dt><dd><a href="/list/state/complete.html">已完结</a><a href="/list/state/ongoing.html">连载中</a></dd></dl></div><form action="/find"><input name="wd" type="search"></form>',role:'status',query:'wd'},
 {engine:'nnyy',identity:'',html:'<div><b>语言</b><a href="?lang=zh">中文</a><a href="?lang=en">英文</a></div>',role:'language'},
 {engine:'jeecms',identity:'<meta name="generator" content="JEECMS">',html:`<form role="search" method="post" action="/search.jspx"><input name="q">${option('channelid','栏目')}</form>`,role:'category',query:'q',method:'POST'},
 {engine:'wordpress',identity:'<meta name="generator" content="WordPress">',html:`<form role="search" action="/"><input type="search" name="s">${option('post_type','类型')}</form>`,role:'category',query:'s'},
 {engine:'typecho',identity:'<meta name="generator" content="Typecho">',html:'<form action="/"><input name="s" type="search"></form><dl><dt>标签</dt><dd><a href="/tag/code/">代码</a><a href="/tag/science/">科学</a></dd></dl>',role:'tag',query:'s'},
 {engine:'dedecms',identity:'<meta name="generator" content="DedeCMS">',html:`<form action="/plus/search.php"><input name="keyword">${option('typeid','栏目')}<input type="hidden" name="kwtype" value="0"></form>`,role:'category',query:'keyword'},
 {engine:'empirecms',identity:'<meta name="generator" content="EmpireCMS">',html:`<form action="/e/search/index.php" method="post"><input name="keyboard">${option('classid','分类')}<input type="hidden" name="show" value="title"></form>`,role:'category',query:'keyboard',method:'POST'},
 {engine:'pbootcms',identity:'<meta name="generator" content="PbootCMS">',html:`<form action="/search/"><input name="keyword">${option('scode','栏目')}</form>`,role:'category',query:'keyword'},
 {engine:'eyoucms',identity:'<meta name="generator" content="EyouCMS">',html:`<form action="/search.php"><input name="keywords">${option('typeid','类型')}</form>`,role:'category',query:'keywords'},
 {engine:'zblog',identity:'<meta name="generator" content="Z-BlogPHP">',html:`<form action="/search.php"><input name="q">${option('cate','分类')}</form>`,role:'category',query:'q'},
 {engine:'drupal',identity:'<meta name="generator" content="Drupal">',html:`<form class="views-exposed-form" action="/content"><input name="combine">${option('sort_by','Sort by')}${option('field_year_value','年份')}</form>`,role:'sort',query:'combine'},
 {engine:'joomla',identity:'<meta name="generator" content="Joomla!">',html:`<form action="/index.php?option=com_content"><input name="filter[search]">${option('filter[category_id]','Category')}${option('list[ordering]','Ordering')}</form>`,role:'sort',query:'filter[search]'},
 {engine:'hugo',identity:'<meta name="generator" content="Hugo">',html:'<section><div><label>年份</label><a href="/archives/2025/">2025</a><a href="/archives/2026/">2026</a></div></section>',role:'year'},
 {engine:'hexo',identity:'<meta name="generator" content="Hexo">',html:'<dl><dt>标签</dt><dd><a href="/tags/code/">Code</a><a href="/tags/life/">Life</a></dd></dl>',role:'tag'},
 {engine:'ghost',identity:'<meta name="generator" content="Ghost">',html:'<fieldset aria-label="类型"><a href="/tag/news/">News</a><a href="/tag/notes/">Notes</a></fieldset>',role:'genre'},
 {engine:'generic',identity:'',html:'<section><div><span>地区</span><a href="/directory?region=europe">欧洲</a><a href="/directory?region=asia">亚洲</a></div></section><form role="search" action="/search"><input type="search" name="q"></form>',role:'region',query:'q'},
]

test('capability registry covers every supported identity and no identity manufactures features',()=>{
 assert.deepEqual(Object.keys(CMS_CAPABILITY_ADAPTERS).sort(),cases.map(item=>item.engine).sort())
 for(const item of cases){
  const page=parseCatalogPage({...source,frameworkHint:{framework:item.engine,paginationPattern:{kind:'next-link'}}},{url:source.url,method:'GET'},item.identity+card)
  assert.equal(page.capabilities?.controls.length,0,item.engine)
  assert.equal(page.capabilities?.search,undefined,item.engine)
 }
})
for(const entry of cases){
 test(`${entry.engine}: actual template controls become executable requests without engine URL synthesis`,()=>{
  const src={...source,frameworkHint:{framework:entry.engine,paginationPattern:{kind:'next-link' as const}}}
  const html=entry.identity+entry.html+card+'<nav class="pagination"><a rel="next" href="?offset=40">Next</a></nav>'
  const page=parseCatalogPage(src,{method:'GET',url:source.url},html)
  assert.equal(page.capabilities?.engine,entry.engine)
  const control=page.capabilities?.controls.find(item=>item.semantic===entry.role)
  assert.ok(control,entry.engine+' '+entry.role)
  assert.ok(control.choices.length>=2)
  assert.ok(control.choices.every(item=>new URL(item.request.url).origin==='https://matrix.example'))
  assert.equal(page.pagination.nextUrl,'https://matrix.example/list/?offset=40')
  assert.equal(page.articles.length,1)
  if(entry.query){
   const request=catalogSearchRequest(page.capabilities!,'a&中文')!
   assert.ok(request)
   assert.equal(request.method,entry.method||'GET')
   const fields=request.fields??Object.entries(request.form??{}).map(([name,value])=>({name,value}))
   assert.equal(request.method==='GET'?new URL(request.url).searchParams.get(entry.query):fields.find(item=>item.name===entry.query)?.value,'a&中文')
  }
 })
}

test('structural year inference survives classname replacement and additional neutral wrappers',()=>{
 for(const tag of ['div','section','main'])for(const wrapper of ['div','dl']){
  const html=`<${tag} class="random-828"><${wrapper}><div><strong>年份</strong><a href="/f?x=2025">2025</a><a href="/f?x=2026">2026</a></div></${wrapper}></${tag}>`+card
  const page=parseCatalogPage(source,{url:source.url,method:'GET'},html)
  assert.equal(page.capabilities?.controls.find(item=>item.semantic==='year')?.choices.length,2,tag+'/'+wrapper)
 }
})

test('URL-valued select exposes declared navigation but plain JavaScript values do not',()=>{
 const html='<label>年份<select name="year" onchange="location.href=this.value"><option value="/browse?year=2025" selected>2025</option><option value="/browse?year=2026">2026</option></select></label>'+card
 const page=parseCatalogPage(source,{url:source.url,method:'GET'},html)
 assert.equal(page.capabilities?.controls[0]?.choices[1]?.request.url,'https://matrix.example/browse?year=2026')
})
