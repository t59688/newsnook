package com.aizeek.newsnook;

final class CatalogSnapshotScript {
    private CatalogSnapshotScript() {}

    /** Fixed read-only ES2018 probe. Navigation and loading placeholders are not content. */
    static final String PROBE =
        "(function(){try{var root=document.documentElement;" +
        "if(!root){return JSON.stringify({ready:false,url:location.href});" +
        "}var scope=document.querySelector('main,[role=main],#app,#root,#__next')||document.body;" +
        "if(!scope){return JSON.stringify({ready:false,url:location.href});" +
        "}var busy=scope.matches('[aria-busy=true],[data-loading=true]')||scope.querySelector('[aria-busy=true]:not([hidden]),[data-loading=true]:not([hidden])');" +
        "if(busy){return JSON.stringify({ready:false,url:location.href});" +
        "}var ignored='header,footer,aside,nav,[role=navigation],script,style,template,.skeleton,.skeleton-loader,.loading-placeholder,[data-placeholder],[role=progressbar]';" +
        "if(scope.matches(ignored)){return JSON.stringify({ready:false,url:location.href});" +
        "}var content=scope.cloneNode(true);" +
        "var noise=content.querySelectorAll(ignored);" +
        "for(var n=0;" +
        "n<noise.length;" +
        "n++){noise[n].remove();" +
        "}var text=(content.textContent||'').replace(/\\s+/g,' ').trim();" +
        "var anchors=scope.querySelectorAll('a[href]');" +
        "var signals=0;" +
        "for(var a=0;" +
        "a<anchors.length;" +
        "a++){var href=anchors[a].getAttribute('href')||'';" +
        "if(!anchors[a].closest(ignored)&&href&&href.charAt(0)!=='#'&&!/^javascript:/i.test(href)){signals++;" +
        "}}var items=scope.querySelectorAll('article a[href],.card a[href],.post a[href],.entry a[href],[role=listitem] a[href]');" +
        "var hasItem=false;" +
        "for(var i=0;" +
        "i<items.length;" +
        "i++){if(!items[i].closest(ignored)){hasItem=true;" +
        "break;" +
        "}}var fields=scope.querySelectorAll('form input[name]:not([type=hidden]):not([type=password]),form select[name]');" +
        "var hasField=false;" +
        "for(var f=0;" +
        "f<fields.length;" +
        "f++){if(!fields[f].closest(ignored)){hasField=true;" +
        "break;" +
        "}}var empty=/no results|nothing found|not found|\u6682\u65e0|\u6ca1\u6709\u627e\u5230|\u672a\u627e\u5230|\u65e0\u76f8\u5173/i.test(text);" +
        "var meaningful=signals>=2||hasItem||hasField||empty;" +
        "if(document.readyState==='loading'||!meaningful){return JSON.stringify({ready:false,url:location.href});" +
        "}var clone=root.cloneNode(true);" +
        "var sources=root.querySelectorAll('input');" +
        "var targets=clone.querySelectorAll('input');" +
        "for(var i=0;" +
        "i<sources.length&&i<targets.length;" +
        "i++){var source=sources[i],target=targets[i],type=(source.type||'').toLowerCase();" +
        "if(type === 'password'){target.removeAttribute('value');" +
        "}else if(type==='checkbox'||type==='radio'){if(source.checked){target.setAttribute('checked','');" +
        "}else{target.removeAttribute('checked');" +
        "}}else{target.setAttribute('value',source.value||'');" +
        "}}sources=root.querySelectorAll('textarea');" +
        "targets=clone.querySelectorAll('textarea');" +
        "for(i=0;" +
        "i<sources.length&&i<targets.length;" +
        "i++){targets[i].textContent=sources[i].value||'';" +
        "}sources=root.querySelectorAll('option');" +
        "targets=clone.querySelectorAll('option');" +
        "for(i=0;" +
        "i<sources.length&&i<targets.length;" +
        "i++){source=sources[i];" +
        "if(source.selected){targets[i].setAttribute('selected','');" +
        "}else{targets[i].removeAttribute('selected');" +
        "}}var html=(document.doctype?'<!DOCTYPE '+document.doctype.name+'>':'')+clone.outerHTML;" +
        "var bytes=unescape(encodeURIComponent(html)).length;" +
        "if(bytes>2097152){return JSON.stringify({ready:true,tooLarge:true,bytes:bytes,url:location.href});" +
        "}return JSON.stringify({ready:true,html:html,bytes:bytes,url:location.href});" +
        "}catch(error){return JSON.stringify({ready:false,url:location.href});" +
        "}})()";
}
