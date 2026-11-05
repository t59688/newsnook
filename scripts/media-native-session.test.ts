import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Capacitor, registerPlugin } from '@capacitor/core'
let listenerCount=0, cancellations=0, rejectStart=false
let lastSession=''
const events=new Map<string,(value:Record<string,unknown>)=>void>()
let finishSniff: ((value: {observations: never[]}) => void) | undefined
registerPlugin('MediaSniffer', { web: () => ({
  async addListener(name:string,callback:(value:Record<string,unknown>)=>void) { events.set(name,callback);listenerCount++; return { remove:async()=>{listenerCount--;events.delete(name)} } },
  async startLiveSession(options:{sessionId:string}) { lastSession=options.sessionId;if (rejectStart) throw new Error('Cannot create surface') },
  async stopLiveSession() {},
  async sniff() { return new Promise(resolve=>{ finishSniff=resolve }) },
  async cancelSniff() { cancellations++; finishSniff?.({observations:[]}) },
}) as never })
const { startNativeLiveSniffSession, observeMediaInNativePage } = await import('../src/features/mediaSniffer/native')
Capacitor.getPlatform=()=>'android'
Capacitor.isNativePlatform=()=>true

test('failed native live startup releases its observation listener',async()=>{
  rejectStart=true
  await assert.rejects(startNativeLiveSniffSession({url:'https://video.example/watch/1',onObservation:()=>{}}))
  assert.equal(listenerCount,0)
  rejectStart=false
})

test('cancelling an active discovery closes the native probe and releases listeners',async()=>{
  const controller=new AbortController()
  const running=observeMediaInNativePage('https://video.example/watch/1',6000,undefined,undefined,controller.signal)
  await new Promise(resolve=>setTimeout(resolve,10))
  controller.abort()
  const result=await Promise.race([running,new Promise(resolve=>setTimeout(()=>resolve('timeout'),200))])
  assert.deepEqual(result,[])
  assert.equal(cancellations,1)
  assert.equal(listenerCount,0)
})


test('a document navigation clears the old candidate before any new media request',async()=>{
  const changed:number[]=[]
  const session=await startNativeLiveSniffSession({url:'https://video.example/watch/1',onObservation:()=>{},onDocumentChanged:epoch=>changed.push(epoch)})
  events.get('mediaDocument')?.({sessionId:lastSession,documentEpoch:1,pageUrl:'https://video.example/watch/1'})
  events.get('mediaDocument')?.({sessionId:lastSession,documentEpoch:2,pageUrl:'https://video.example/watch/2'})
  assert.deepEqual(changed,[2])
  await session.stop()
  assert.equal(listenerCount,0)
})
