import {$,esc,uid,host,validUrl,normalized,classify,fallbackThumbnail,socialMediaEmbed,videoCollectionTitle} from './utils.js';
import {openDB,migrateLegacy,loadLibrary,storeItem,storeSection,removeItem,removeSection} from './storage.js';
import {previewUrl} from './importer.js';
import {createLibraryShareLink,hasLibraryShareLink,readLibraryShareLink} from './share.js';

'use strict';
const V={view:'all',sectionId:null,tag:null,q:'',type:'all',sort:'recent',selectMode:false,selected:new Set(),mediaIndex:-1,dialogItemId:null,dialogMode:'view',items:[],sections:[],downloads:[],downloadPreview:null,downloadError:'',downloadUrl:'',installPrompt:null,preview:null,showingHiddenMedia:false,watch:null,watchScrollTimer:null,watchResizeObserver:null};
let appUpdatePending=false;
let reloadingForAppUpdate=false;
const icon=d=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const icons={all:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',inbox:'M3 12h5l1 2h6l1-2h5M5 5h14l2 7v7H3v-7z',star:'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',recent:'M3 12a9 9 0 1 0 3-6.7M3 4v5h5m4-1v5l3 2',archive:'M3 5h18v4H3zM5 9v11h14V9m-9 4h4',section:'M3 5h18v15H3zM3 9h18M7 5V3h10v2',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',more:'M12 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2',hide:'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.3 4.2 9 7-.3 1.2-1 2.3-1.8 3.2M6.2 6.2C4 7.5 2.5 9.7 2 12c.7 2.8 4 7 10 7 1.2 0 2.3-.2 3.3-.6'};
function toast(message){const el=$('#ts');el.textContent=message;el.classList.add('on');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('on'),2800)}
function applyTheme(theme,persist=false){const selected=theme==='light'?'light':'dark';document.documentElement.dataset.theme=selected;const button=$('#themeToggle');button.textContent=selected==='light'?'☾':'☼';button.title=`Switch to ${selected==='light'?'dark':'light'} theme`;button.setAttribute('aria-label',button.title);const themeColor=document.querySelector('meta[name="theme-color"]');if(themeColor)themeColor.content=selected==='light'?'#f4f4f6':'#0b0b0c';if(persist){try{localStorage.setItem('grabit-theme',selected)}catch(error){reportError('Could not remember theme preference',error)}}}
async function refreshLibrary(){const data=await loadLibrary();V.items=data.items;V.sections=data.sections}
function loadDownloadHistory(){try{const stored=JSON.parse(localStorage.getItem('grabit-download-history')||'[]');V.downloads=Array.isArray(stored)?stored.filter(entry=>entry&&typeof entry==='object'&&(typeof entry.url==='string'||typeof entry.localMediaId==='string')).slice(0,200):[]}catch(error){console.warn('Could not read download history:',error);V.downloads=[]}}
function storeDownloadHistory(){try{localStorage.setItem('grabit-download-history',JSON.stringify(V.downloads.slice(0,200)))}catch(error){reportError('Could not save download history',error)}}
function show(html,wide=false){$('#bx').innerHTML=html;$('#bx').classList.toggle('wide',wide);$('#md').classList.remove('image-view-mode');$('#md').classList.add('on');const focus=$('#bx input,#bx textarea,#bx select,#bx button');focus?.focus()}
function hide(){const active=document.activeElement;$('#md').classList.remove('on','image-view-mode');$('#bx').innerHTML='';V.dialogItemId=null;V.dialogMode='view';if(active&&active.matches('input,textarea,select'))$('#add').focus();reloadForAppUpdate()}
function reloadForAppUpdate(){
 if(!appUpdatePending||reloadingForAppUpdate||$('#md').classList.contains('on'))return;
 if([...document.querySelectorAll('input[type="file"]')].some(input=>input.files?.length))return;
 appUpdatePending=false;reloadingForAppUpdate=true;location.reload();
}
function watchForAppUpdates(){
 if(!('serviceWorker'in navigator))return;
 let hadController=Boolean(navigator.serviceWorker.controller);
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!hadController){hadController=true;return}
  appUpdatePending=true;
  if($('#md').classList.contains('on')||[...document.querySelectorAll('input[type="file"]')].some(input=>input.files?.length)){
   toast('An update is ready. Save your open work and close this dialog to apply it.');
   return;
  }
  reloadForAppUpdate();
 });
 navigator.serviceWorker.register('./service-worker.js').then(registration=>{
  const checkForUpdate=()=>registration.update().catch(error=>console.warn('Grabit could not check for an app update:',error));
  checkForUpdate();
  setInterval(()=>{if(document.visibilityState==='visible')checkForUpdate()},5*60*1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdate()});
 }).catch(error=>console.error('Grabit could not register offline support:',error));
}
function sectionName(id){return V.sections.find(s=>s.id===id)?.name||''}
function sectionOptions(selected=[]){return V.sections.map(s=>`<label class="checklist"><input type="checkbox" name="section" value="${esc(s.id)}"${selected.includes(s.id)?' checked':''}> ${esc(s.name)}</label>`).join('')||'<div class="hint">No sections yet. Create one in the sidebar.</div>'}
function destinationOptions(){return`<select class="in" name="destination" aria-label="Save destination"><option value="">Inbox</option>${V.sections.map(section=>`<option value="${esc(section.id)}">${esc(section.name)}</option>`).join('')}</select>`}
function watchUrl(){const url=new URL(location.href);if(V.watch){url.searchParams.set('watch',V.watch.itemId);url.searchParams.set('page',String(V.watch.pageIndex));url.searchParams.set('media',String(V.watch.mediaIndex));url.searchParams.set('scroll',String(Math.max(0,Math.round(V.watch.scrollTop||0))))}else for(const key of ['watch','page','media','scroll'])url.searchParams.delete(key);return url}
function syncWatchUrl(push=false){
 const url=watchUrl();
 history[push?'pushState':'replaceState']({grabitWatch:!!V.watch},'',url);
 try{
  if(V.watch)sessionStorage.setItem('grabit-watch-route',JSON.stringify({itemId:V.watch.itemId,pageIndex:V.watch.pageIndex,mediaIndex:V.watch.mediaIndex,scrollTop:V.watch.scrollTop||0}));
  else sessionStorage.removeItem('grabit-watch-route');
 }catch(error){console.warn('Grabit could not persist the current viewer position for reload:',error)}
}
function readWatchRoute(){
 const params=new URLSearchParams(location.search);
 let route=params.get('watch')?{itemId:params.get('watch'),pageIndex:params.get('page'),mediaIndex:params.get('media'),scrollTop:params.get('scroll')}:null;
 if(!route){
  try{route=JSON.parse(sessionStorage.getItem('grabit-watch-route')||'null')}catch(error){console.warn('Grabit could not restore the saved viewer position:',error)}
 }
 if(!route||typeof route.itemId!=='string'||!route.itemId){V.watch=null;$('#win').classList.remove('watch-mode');$('#main').classList.remove('full-viewer','focused-view');return false}
 const pageIndex=Number(route.pageIndex),mediaIndex=route.mediaIndex===null||route.mediaIndex===undefined?-1:Number(route.mediaIndex),scrollTop=Number(route.scrollTop);
 V.watch={itemId:route.itemId,pageIndex:Number.isFinite(pageIndex)?Math.max(0,pageIndex):0,mediaIndex:Number.isFinite(mediaIndex)?mediaIndex:-1,scrollTop:Number.isFinite(scrollTop)?Math.max(0,scrollTop):0,lastScrollTop:Number.isFinite(scrollTop)?Math.max(0,scrollTop):0,headerHidden:false,showingHidden:false};
 return true;
}
function allTags(){return [...new Set(V.items.flatMap(i=>i.tags||[]))].sort((a,b)=>a.localeCompare(b))}
function navItem(view,label,ic,count,sectionId){return `<div class="nv${V.view===view&&(view!=='section'||V.sectionId===sectionId)?' on':''}" role="button" tabindex="0" data-view="${view}"${sectionId?` data-section="${esc(sectionId)}"`:''}>${icon(ic)}<span>${esc(label)}</span>${count?`<em>${count}</em>`:''}</div>`}
function renderNav(){
 const live=V.items.filter(i=>!i.isArchived);
 const count=(fn)=>live.filter(fn).length;
 $('#nav').innerHTML=`<div class="sec">Library</div>${navItem('all','All content',icons.all,count(i=>!i.hiddenFromAll))}${navItem('inbox','Inbox',icons.inbox,count(i=>i.inbox))}${navItem('favorites','Favorites',icons.star,count(i=>i.isFavorite))}${navItem('recent','Recently added',icons.recent)}${navItem('downloads','Download',icons.download,V.downloads.length)}${navItem('archived','Archived',icons.archive)}
 <div class="sec">Sections<button id="addSection" title="Create section" aria-label="Create section">+</button></div>${V.sections.map(s=>`<div class="section-entry">${navItem('section',s.name,icons.section,count(i=>!i.isArchived&&(i.sectionIds||[]).includes(s.id)),s.id)}<button class="section-manage" data-manage-section="${esc(s.id)}" aria-label="Manage ${esc(s.name)}" title="Manage section">${icon(icons.more)}</button></div>`).join('')}
 <div class="sec">Library tools</div><div class="nv" id="installApp" role="button" tabindex="0">${icon('M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4')}<span>Install Grabit app</span></div><div class="nv" id="exportLibrary" role="button" tabindex="0">${icon('M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4')}<span>Export library</span></div>`;
}
function matchingItems(){
 const q=V.q.trim().toLocaleLowerCase();
 let items=V.items.filter(i=>{
  if(V.view==='archived'?!i.isArchived:i.isArchived)return false;
  if(V.view==='all'&&i.hiddenFromAll)return false;
  if(V.view==='recent'&&Date.parse(i.savedAt)<Date.now()-7*24*60*60*1000)return false;
  if(V.view==='inbox'&&!i.inbox)return false;
  if(V.view==='favorites'&&!i.isFavorite)return false;
  if(V.view==='downloads'&&!V.downloads.some(entry=>entry.itemId===i.id))return false;
  if(V.view==='section'&&!(i.sectionIds||[]).includes(V.sectionId))return false;
  if(V.tag&&!(i.tags||[]).some(t=>t.toLocaleLowerCase()===V.tag.toLocaleLowerCase()))return false;
  if(V.type!=='all'&&i.type!==V.type)return false;
  if(q&&!`${i.title} ${i.description} ${i.notes} ${(i.tags||[]).join(' ')} ${i.sourceDomain} ${i.sourceUrl} ${i.originalUrl}`.toLocaleLowerCase().includes(q))return false;
  return true;
 });
 items.sort((a,b)=>V.sort==='oldest'?Date.parse(a.savedAt)-Date.parse(b.savedAt):V.sort==='alphabetical'?a.title.localeCompare(b.title):V.sort==='updated'?Date.parse(b.updatedAt)-Date.parse(a.updatedAt):Date.parse(b.savedAt)-Date.parse(a.savedAt));
 return items;
}
function thumbUrl(item){if(item.type==='note')return '';return item.thumbnailUrl||item.media?.find(m=>m.type==='image')?.sourceUrl||item.media?.find(m=>m.thumbnailUrl)?.thumbnailUrl||fallbackThumbnail(item.type)}
function card(item){
 const thumb=thumbUrl(item);const hasMorePlaylistVideos=item.type==='playlist'&&item.sourcePages?.some(page=>page.playlistPaging&&page.playlistHasMore);const labels={bookmark:'WEB',note:'NOTE',image:'IMAGE',video:'VIDEO',gallery:`GALLERY · ${item.media.length}`,playlist:`PLAYLIST · ${item.media.length}${hasMorePlaylistVideos?'+':''}`};
 const image=item.type==='note'?'':`<img class="art" src="${esc(thumb)}" alt="" loading="lazy" decoding="async">`;
 return `<article class="card${item.type==='note'?' note-card':''}" data-id="${esc(item.id)}" tabindex="0" aria-label="${esc(item.title)}">
 ${image}<span class="bd">${labels[item.type]||'ITEM'}</span><div class="cap">${esc(item.title||'Untitled')}</div>${item.sourceDomain?`<div class="source">${esc(item.sourceDomain)}</div>`:''}
 <button class="card-menu-button" data-card-menu="${esc(item.id)}" aria-label="More actions for ${esc(item.title)}" aria-haspopup="menu" aria-expanded="false">${icon(icons.more)}</button><div class="card-menu" role="menu">${item.sectionIds?.length?`<button role="menuitem" data-card-action="allVisibility" data-id="${esc(item.id)}">${item.hiddenFromAll?'Show in All content':'Hide from All content'}</button>`:''}<button role="menuitem" data-card-action="edit" data-id="${esc(item.id)}">Edit</button><button role="menuitem" data-card-action="favorite" data-id="${esc(item.id)}">${item.isFavorite?'Remove favorite':'Add to favorites'}</button><button role="menuitem" data-card-action="archive" data-id="${esc(item.id)}">${item.isArchived?'Restore':'Archive'}</button><button role="menuitem" class="d" data-card-action="delete" data-id="${esc(item.id)}">Delete</button></div>${V.selectMode?`<input class="select-card" type="checkbox" data-select="${esc(item.id)}" aria-label="Select ${esc(item.title)}"${V.selected.has(item.id)?' checked':''} style="position:absolute;top:9px;left:9px;width:19px;height:19px;accent-color:var(--ac)">`:''}</article>`;
}
function positionCardMenu(menu,button){
 const margin=8,trigger=button.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
 const left=Math.max(margin,Math.min(trigger.right-bounds.width,innerWidth-bounds.width-margin));
 const below=trigger.bottom+6,above=trigger.top-bounds.height-6;
 const top=below+bounds.height<=innerHeight-margin||above<margin?Math.min(below,innerHeight-bounds.height-margin):above;
 menu.style.setProperty('--menu-left',`${left}px`);
 menu.style.setProperty('--menu-top',`${Math.max(margin,top)}px`);
}
function closeCardMenus(){
 document.querySelectorAll('.card-menu.open').forEach(menu=>{
  menu.classList.remove('open');menu.style.removeProperty('--menu-left');menu.style.removeProperty('--menu-top');
  menu.closest('.card')?.classList.remove('menu-open');menu.previousElementSibling?.setAttribute('aria-expanded','false');
 });
}
function titleForView(){return V.view==='section'?sectionName(V.sectionId):({all:'All content',inbox:'Inbox',favorites:'Favorites',recent:'Recently added',downloads:'Download',archived:'Archived'}[V.view]||'All content')}
function render(){
 renderNav();$('#ttl').textContent=titleForView();
 if(V.view==='downloads'){renderDownloadHistory();return}
 const items=matchingItems();const main=$('#main');
 const types=['all','bookmark','image','video','gallery','playlist','note'];
 const typeLabels={all:'All types',bookmark:'Websites',image:'Images',video:'Videos',gallery:'Galleries',playlist:'Playlists',note:'Notes'};
 const actions=V.selectMode?`<button class="b" data-bulk="selectAll">Select all</button><button class="b" data-bulk="tag">Edit tags</button><button class="b" data-bulk="inbox">Move to Inbox</button><select class="in" id="bulkSection" aria-label="Move selected to section"><option value="">Move to section…</option>${V.sections.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><button class="b d" data-bulk="delete">Delete</button><button class="b" data-bulk="done">Done</button>`:`<button class="b" id="selectMode">Select</button>`;
 const toolbar=`<div class="tools"><select class="in" id="typeFilter" aria-label="Filter by content type">${types.map(t=>`<option value="${t}"${V.type===t?' selected':''}>${typeLabels[t]}</option>`).join('')}</select><select class="in" id="sortOrder" aria-label="Sort content"><option value="recent"${V.sort==='recent'?' selected':''}>Recently added</option><option value="oldest"${V.sort==='oldest'?' selected':''}>Oldest added</option><option value="alphabetical"${V.sort==='alphabetical'?' selected':''}>Alphabetical</option><option value="updated"${V.sort==='updated'?' selected':''}>Recently updated</option></select>${actions}</div>`;
 const empty=V.view==='inbox'?'Your Inbox is empty. Add a URL now and organize it later.':V.view==='favorites'?'Favorite items appear here.':V.view==='archived'?'No archived items.':V.view==='section'?'This section is empty. Add content or move items here.':'Your library is empty. Add a URL, note, or image to get started.';
 main.innerHTML=toolbar+(items.length?`<div class="grid">${items.map(card).join('')}</div>`:`<div class="empty">${V.q?`No results for “${esc(V.q)}”.`:esc(empty)}</div>`);
}
function imageFile(file){return new Promise((resolve,reject)=>{if(!file||!file.type.startsWith('image/')){reject(new Error('Choose a valid image file.'));return}if(file.size>12*1024*1024){reject(new Error('Images must be smaller than 12 MB for local storage.'));return}const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read the selected image.'));reader.onload=()=>{const image=new Image();image.onerror=()=>reject(new Error('The selected file is not a readable image.'));image.onload=()=>{const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');if(!ctx){reject(new Error('Image processing is unavailable.'));return}ctx.drawImage(image,0,0,canvas.width,canvas.height);resolve({data:canvas.toDataURL('image/jpeg',.84),width:canvas.width,height:canvas.height})};image.src=reader.result};reader.readAsDataURL(file)})}
function emptyItem({type,title,sourceUrl='',media=[],thumbnailUrl='',notes='',description='',tags=[],sectionIds=[]}){
 const now=new Date().toISOString();return{id:uid(),type,title:title.trim()||host(sourceUrl)||'Untitled',description,notes,sourceUrl,originalUrl:sourceUrl,canonicalUrl:normalized(sourceUrl),sourceDomain:host(sourceUrl),thumbnailUrl,media:media.map((m,position)=>({...m,id:m.id||uid(),position})),tags:[...new Set(tags.map(x=>x.trim()).filter(Boolean))],sectionIds,isFavorite:false,isArchived:false,hiddenFromAll:false,inbox:sectionIds.length===0,savedAt:now,updatedAt:now};
}
function addDialog(){
 show(`<b>Add to your library</b><p class="hint">Save a link, add a note, or upload images.</p><div class="row"><button class="b p" data-action="importDialog">Save URL(s)</button><button class="b" data-action="noteDialog">New note</button><button class="b" data-action="uploadDialog">Upload images</button><button class="b" data-action="close">Cancel</button></div>`);
}
function importDialog(){
 V.preview=null;
 show(`<b>Save URL(s)</b><p class="hint">Save webpages or media links. Creator lists become playlists with 10 videos per page; use the arrows to browse.</p>
 <label for="urls">URL(s)</label><textarea class="in" id="urls" placeholder="https://example.com/article&#10;https://example.com/photo.jpg" autocomplete="url"></textarea>
 <label for="mediaKind">Media to detect</label><select class="in" id="mediaKind"><option value="all">Auto-detect images and videos</option><option value="image">Images only</option><option value="video">Videos only</option></select>
 <div class="row"><button class="b p" data-action="previewPage">Detect and preview media</button></div><div id="extractionPreview"></div>
 <label for="importTitle">Title (optional; applied when importing one URL)</label><input class="in" id="importTitle" maxlength="240" placeholder="Page title">
 <label for="importDescription">Description (optional)</label><textarea class="in" id="importDescription" maxlength="3000" placeholder="Description"></textarea>
 <label>Save to</label><div id="importSections">${destinationOptions()}</div>
 <p class="hint">Multiple direct links are grouped into a gallery or playlist.</p>
 <div class="row"><button class="b p" id="saveImportButton" data-action="saveImport">Save URL(s)</button><button class="b" data-action="close">Cancel</button></div>`);
}
function previewPanel(){
 const state=V.preview;if(!state)return;
 const countSelected=state.pages.reduce((count,page)=>count+page.media.filter(media=>page.selected.has(media.url)).length,0);
 const hiddenCount=new Set(state.pages.flatMap(page=>[...page.hiddenUrls])).size;
 const sections=state.pages.map((page,pageIndex)=>{
  const available=page.media.map((media,mediaIndex)=>({media,mediaIndex})).filter(({media})=>state.showHidden||!page.hiddenUrls.has(media.url));
  const tiles=available.map(({media,mediaIndex})=>`<div class="media-tile ${media.type==='video'?'video-tile':''}">
   ${media.type==='video'&&media.embedUrl?`<img src="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" alt="" loading="lazy" decoding="async"><span class="play-mark" aria-hidden="true">▶</span>`:media.type==='video'?`<video src="${esc(media.url)}" poster="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" muted playsinline preload="none" tabindex="-1"></video>`:`<img src="${esc(media.thumbnailUrl||media.url)}" alt="${esc(media.alt||`Image ${mediaIndex+1}`)}" loading="lazy" decoding="async">`}
   <label class="media-select"><input type="checkbox" data-preview-page="${pageIndex}" data-preview-select="${esc(media.url)}"${page.selected.has(media.url)?' checked':''}> Select</label>
   <button class="media-menu-button" data-preview-page="${pageIndex}" data-preview-hide="${esc(media.url)}" aria-label="${page.hiddenUrls.has(media.url)?'Unhide':'Hide'} this media">${page.hiddenUrls.has(media.url)?'Unhide':'Hide'}</button>
  </div>`).join('');
  const gallery=page.media.length?`<div class="media-grid preview-grid">${tiles||'<p class="hint">All media are hidden. Use Show hidden media to restore them.</p>'}</div>`:`<p class="hint">${page.error?'This URL could not be previewed.':'No media was detected; the URL will still be included in the full-page viewer.'}</p>`;
  const warnings=[page.mediaWarning,page.previewWarning,page.truncated?'Only the first 500 media items are shown.': ''].filter(Boolean);
  return`<section class="preview-page"><h3>${pageIndex+1}. ${esc(page.title||host(page.url))} <span>${page.media.length} media${page.error?` · ${esc(page.error)}`:''}</span></h3>${warnings.map(warning=>`<p class="hint" role="status">${esc(warning)}</p>`).join('')}${gallery}</section>`;
 }).join('');
 $('#extractionPreview').innerHTML=`<div class="extraction-preview"><div class="extract-summary"><span><b>${state.pages.length} URL${state.pages.length===1?'':'s'} previewed</b><br><span class="hint">${countSelected} media selected · ${hiddenCount} hidden${state.errors.length?` · ${state.errors.length} preview error(s)`:''}</span></span><div><button class="b" data-action="toggleHiddenPreview">${state.showHidden?'Hide previously hidden':'Show previously hidden'} (${hiddenCount})</button></div></div>${sections}</div>`;
 const saveButton=$('#saveImportButton');
 if(saveButton)saveButton.textContent=countSelected?'Save selected media and URLs':'Save URLs for full-page viewing';
}
async function previewPage(requestedUrls){
 const inputs=requestedUrls||$('#urls').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
 const urls=[...new Set(inputs.map(value=>validUrl(value)?.href).filter(Boolean))];
 if(!urls.length){toast('Enter at least one valid webpage URL to preview.');return}
 if(urls.length>12){toast('Preview up to 12 URLs at a time.');return}
 if(urls.length!==inputs.length){toast('One or more URLs are invalid; correct them before previewing.');return}
 const button=$('[data-action="previewPage"]');button.disabled=true;button.textContent='Fetching preview…';
 try{
  const pages=[],errors=[];
  for(const url of urls){
   try{
    const page=await extractPageForWatch(url);
    const mediaKind=$('#mediaKind')?.value||'all';
    if(mediaKind!=='all')page.media=page.media.filter(media=>media.type===mediaKind);
    const canonical=normalized(page.canonicalUrl||url);
    const prior=V.items.filter(item=>item.canonicalUrl===canonical||normalized(item.sourceUrl)===canonical||item.sourceUrls?.some(saved=>normalized(saved)===canonical));
    const hiddenUrls=new Set(prior.flatMap(item=>item.hiddenMediaUrls||[]));
    pages.push({...page,canonicalUrl:canonical,hiddenUrls,selected:new Set(page.media.filter(media=>!hiddenUrls.has(media.url)).map(media=>media.url)),extracted:true});
   }catch(error){errors.push({url,error:error.message});pages.push({url,canonicalUrl:normalized(url),title:host(url),description:'',media:[],hiddenUrls:new Set(),selected:new Set(),error:error.message,extracted:false})}
  }
  if(pages.every(page=>page.error))throw new Error(errors.map(error=>`${host(error.url)}: ${error.error}`).join('; '));
  V.preview={pages,errors,showHidden:false};
  if(urls.length===1&&!$('#importTitle').value.trim())$('#importTitle').value=pages[0].title||'';
  if(urls.length===1&&!$('#importDescription').value.trim())$('#importDescription').value=pages[0].description||'';
  previewPanel();
 }catch(error){toast(error.message||'Could not preview this page.')}
 finally{if(button.isConnected){button.disabled=false;button.textContent='View preview'}}
}
async function savePreview(){
 const state=V.preview;if(!state)return;
 const chosen=selectedSections($('#importSections')),firstPage=state.pages[0];
 const selected=state.pages.flatMap((page,pageIndex)=>page.media.filter(media=>page.selected.has(media.url)).map(media=>({...media,pageIndex})));
 const existingItems=V.items.filter(item=>state.pages.some(page=>item.canonicalUrl===page.canonicalUrl||normalized(item.sourceUrl)===page.canonicalUrl||item.sourceUrls?.some(saved=>normalized(saved)===page.canonicalUrl)));
 const hiddenMediaUrls=[...new Set([...existingItems.flatMap(item=>item.hiddenMediaUrls||[]),...state.pages.flatMap(page=>[...page.hiddenUrls])])];
 const savedMedia=state.pages.flatMap((page,pageIndex)=>page.media.filter(media=>page.selected.has(media.url)||page.hiddenUrls.has(media.url)).map(media=>({...media,pageIndex,hidden:page.hiddenUrls.has(media.url)})));
 const isVideoCollection=Boolean(videoCollectionTitle(firstPage.url));
 if(isVideoCollection&&!savedMedia.some(media=>media.type==='video')){toast('Select at least one video to save this playlist.');return}
 const title=$('#importTitle').value.trim()||firstPage.title||host(firstPage.url);
 const description=$('#importDescription').value.trim()||firstPage.description||'';
 try{
  const selectedMedia=savedMedia.filter(entry=>!entry.hidden);
  const allVideos=selectedMedia.length>0&&selectedMedia.every(media=>media.type==='video');
  const type=isVideoCollection?'playlist':!selectedMedia.length?'bookmark':state.pages.length===1&&selectedMedia.length===1?selectedMedia[0].type:allVideos?'playlist':'gallery';
  const item=emptyItem({type, title,description,sourceUrl:firstPage.url,media:savedMedia.map((entry,position)=>({type:entry.type,sourceUrl:entry.url,embedUrl:entry.embedUrl||'',thumbnailUrl:entry.thumbnailUrl||'',alt:entry.alt||'',width:entry.width,height:entry.height,hidden:entry.hidden,position:entry.position??position,pageIndex:entry.pageIndex})),thumbnailUrl:selected.find(media=>media.type==='image')?.url||selected[0]?.thumbnailUrl||fallbackThumbnail(type),sectionIds:chosen});
  item.canonicalUrl=firstPage.canonicalUrl;item.sourceUrls=state.pages.map(page=>page.url);  item.sourcePages=state.pages.map((page,index)=>({url:page.url,canonicalUrl:page.canonicalUrl,title:page.title,description:page.description,index,extracted:page.extracted,refetchOnOpen:videoCollectionTitle(page.url)?false:page.refetchOnOpen===true,playlistPaging:page.playlistPaging===true,playlistStart:page.playlistStart||1,playlistHasMore:page.playlistHasMore===true,playlistHasMoreByStart:page.playlistHasMoreByStart||{[page.playlistStart||1]:page.playlistHasMore===true},mediaWarning:page.mediaWarning||'',previewWarning:page.previewWarning||'',truncated:!!page.truncated,media:savedMedia.filter(media=>media.pageIndex===index).map(({url,...media},position)=>({...media,sourceUrl:url,position:media.position??position,pageIndex:index}))}));item.hiddenMediaUrls=hiddenMediaUrls;
  await storeItem(item);
  await refreshLibrary();V.preview=null;hide();render();toast(`Saved ${state.pages.length} URL(s) and ${selected.length} media item(s).`);
 }catch(error){reportError('Could not save extracted media',error)}
}
async function toggleMediaVisibility(id,url){
 const item=V.items.find(entry=>entry.id===id);if(!item)return;
 const hidden=new Set(item.hiddenMediaUrls||[]);if(hidden.has(url))hidden.delete(url);else hidden.add(url);
 item.hiddenMediaUrls=[...hidden];if(hidden.has(item.thumbnailUrl))item.thumbnailUrl=defaultThumbnail(item);item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();const updated=V.items.find(entry=>entry.id===id);if(updated){if(V.watch?.itemId===id)renderWatchPage();else renderItemViewer(updated)}}
 catch(error){reportError('Could not update hidden media',error)}
}
function noteDialog(){
 show(`<b>New note</b><label for="noteTitle">Title</label><input class="in" id="noteTitle" maxlength="240"><label for="noteText">Notes</label><textarea class="in" id="noteText" maxlength="10000"></textarea><label for="noteTags">Tags (comma separated)</label><input class="in" id="noteTags" placeholder="ideas, design"><label>Save to</label>${destinationOptions()}<div class="row"><button class="b p" data-action="saveNote">Save note</button><button class="b" data-action="close">Cancel</button></div>`);
}
function uploadDialog(){
 show(`<b>Add images</b><p class="hint">Images are compressed and stored in this browser's IndexedDB. Storage is limited by the browser and device.</p>${V.droppedFiles?.length?`<p>${V.droppedFiles.length} dropped image(s) ready to save.</p>`:''}<label for="imageFiles">Choose image(s)</label><input class="in" id="imageFiles" type="file" accept="image/*" multiple><label>Save to</label>${destinationOptions()}<div class="row"><button class="b p" data-action="saveImages">Save images</button><button class="b" data-action="close">Cancel</button></div>`);
}
function createSection(){show(`<b>New section</b><label for="newSectionName">Name</label><input class="in" id="newSectionName" maxlength="100" placeholder="e.g. Design ideas"><div class="row"><button class="b p" data-action="createSection">Create section</button><button class="b" data-action="close">Cancel</button></div>`)}
async function saveNewSection(){
 const clean=$('#newSectionName').value.trim();if(!clean){toast('Section name cannot be empty.');return}if(V.sections.some(s=>s.name.toLocaleLowerCase()===clean.toLocaleLowerCase())){toast('A section with that name already exists.');return}
 const section={id:uid(),name:clean,description:'',coverImage:'',position:V.sections.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 try{await storeSection(section);V.sections.push(section);hide();render();toast('Section created.')}catch(e){reportError('Could not create section',e)}
}
async function manageSection(id){
 const section=V.sections.find(s=>s.id===id);if(!section)return;
 show(`<b>${esc(section.name)}</b><label for="sectionName">Rename section</label><input class="in" id="sectionName" maxlength="100" value="${esc(section.name)}"><label for="sectionDescription">Description</label><textarea class="in" id="sectionDescription" maxlength="1000">${esc(section.description||'')}</textarea><div class="row"><button class="b p" data-action="saveSection" data-id="${esc(id)}">Save</button><button class="b d" data-action="deleteSection" data-id="${esc(id)}">Delete section…</button><button class="b" data-action="close">Close</button></div>`);
}
function detail(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;
 if(item.type==='note'){V.dialogItemId=id;V.mediaIndex=-1;renderItemViewer(item);return}
 startWatch(id);
}
function startWatch(id){
 const existing=V.watch;
 const item=V.items.find(entry=>entry.id===id);
 V.watch={itemId:id,pageIndex:existing?.itemId===id?existing.pageIndex:0,mediaIndex:existing?.itemId===id?existing.mediaIndex:['image','video'].includes(item?.type)||item?.type==='bookmark'&&item.media?.length===1&&item.media[0].type==='video'?0:-1,scrollTop:0,showingHidden:false};
 syncWatchUrl(!existing);renderWatchPage(true);
}
function orderedMedia(item){return(item.media||[]).slice().sort((a,b)=>(a.position||0)-(b.position||0))}
function mediaSource(media){return media.storedDataUrl||media.sourceUrl||''}
function viewerMedia(item){return orderedMedia(item)}
function sourcePages(item){
 if(Array.isArray(item.sourcePages)&&item.sourcePages.length)return item.sourcePages.map((page,index)=>({...page,index,media:Array.isArray(page.media)?page.media:item.media.filter(media=>(media.pageIndex||0)===index)}));
 return[{url:item.sourceUrl||'',title:item.title||host(item.sourceUrl),description:item.description||'',media:orderedMedia(item),index:0}];
}
function watchPageMedia(item,page){
 const media=page.media||[];
 if(!page.playlistPaging)return media;
 const start=page.playlistStart||1;
 return media.filter(entry=>(entry.position??0)>=start-1&&(entry.position??0)<start+9);
}
function defaultThumbnail(item){
 const hidden=new Set(item.hiddenMediaUrls||[]);
 const media=(item.media||[]).filter(entry=>!hidden.has(entry.sourceUrl));
 const image=media.find(entry=>entry.type==='image');
 if(image)return image.thumbnailUrl||image.storedDataUrl||image.sourceUrl;
 const video=media.find(entry=>entry.type==='video');
 return video?.thumbnailUrl||video?.storedDataUrl||fallbackThumbnail(item.type);
}
function downloadUrl(media){return media.downloadUrl||(!media.embedUrl?media.sourceUrl:'')}
function downloadButton(item,media,label='Download',className='b media-download-button',role=''){
 const url=downloadUrl(media);
 const target=url?`data-download-url="${esc(url)}"`:media.storedDataUrl?`data-download-local="${esc(media.id)}"`:'';
 const roleAttribute=role?` role="${role}"`:'';
 return target?`<button class="${className}"${roleAttribute} ${target} data-download-title="${esc(item.title)}" data-download-type="${esc(media.type)}" data-download-thumb="${esc(media.thumbnailUrl||'')}" data-download-item="${esc(item.id)}">${label}</button>`:`<button class="${className}"${roleAttribute} disabled title="This provider embed does not expose a downloadable media file.">${label} unavailable</button>`;
}
async function downloadMedia(url,{itemId='',title='Media',type='image',thumbnailUrl=''}={}){
 if(!url){toast('This media has no downloadable source URL.');return}
 try{
  const local=url.startsWith('data:')||url.startsWith('blob:');
  const anchor=document.createElement('a');let filename='';
  if(local){
   const blob=await(await fetch(url)).blob();
   if(!blob.size)throw new Error('The downloaded media file is empty.');
   const objectUrl=URL.createObjectURL(blob);
   filename=`${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')||'media'}.${type==='video'?'mp4':'jpg'}`;
   anchor.href=objectUrl;anchor.download=filename;setTimeout(()=>URL.revokeObjectURL(objectUrl),60_000);
  }else{
   anchor.href=`/api/download?url=${encodeURIComponent(url)}`;
   anchor.rel='noopener';
   filename=host(url)||title||'media';
  }
  document.body.append(anchor);anchor.click();anchor.remove();
  V.downloads.unshift({itemId,url,title,type,thumbnailUrl,filename,downloadedAt:new Date().toISOString()});V.downloads=V.downloads.slice(0,200);storeDownloadHistory();renderNav();toast(`Download started: ${filename}`);
 }catch(error){console.error('Media download failed:',error);toast(error.message||'Could not download this media.')}
}
function renderDownloadHistory(){
 const records=V.downloads;
 const downloads=V.downloadPreview;
 const content=downloads?downloads.media.length?`<h2 class="download-heading">${esc(downloads.title)} <span>${downloads.media.length} media candidate(s)</span></h2><p class="hint">Candidates with known dimensions are listed highest-resolution first. Providers may restrict access, and Grabit cannot download protected or login-only media.</p>${downloads.warning?`<p class="hint" role="status">${esc(downloads.warning)}</p>`:''}${downloads.truncated?'<p class="hint" role="status">Only the first 500 media items are shown.</p>':''}<div class="download-discovery-grid">${downloads.media.map((media,index)=>`<article class="download-discovery-card"><div class="download-discovery-thumb">${media.type==='video'?`<video src="${esc(media.url)}" poster="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" muted playsinline preload="none"></video>`:`<img src="${esc(media.thumbnailUrl||media.url)}" alt="" loading="lazy" decoding="async">`}</div><div class="download-discovery-copy"><strong>${esc(media.type==='video'?'Video':'Image')} ${index+1}${index===0?' · highest exposed quality':''}</strong><span>${media.width||media.height?`${media.width||'?'} × ${media.height||'?'} px · `:''}${esc(host(media.url))}</span></div>${media.embedUrl?`<p class="hint">This is a provider embed; a downloadable file URL was not exposed.</p>`:`<button class="b p" data-discovery-download="${index}">Download${index===0?' highest listed quality':''}</button>`}</article>`).join('')}</div>`:`<div class="download-empty"><b>No downloadable media was exposed.</b><p>Some social posts provide an embed only, or require sign-in. Grabit does not bypass provider restrictions. Try a public page with directly accessible media.</p></div>`:'';
 const history=records.length?`<div class="download-history">${records.map((entry,index)=>`<article class="download-record"><img src="${esc(entry.thumbnailUrl||fallbackThumbnail(entry.type||'media'))}" alt="" loading="lazy"><div class="download-record-copy"><strong>${esc(entry.title||entry.filename||'Media download')}</strong><span>${esc(entry.filename||host(entry.url||''))} · ${esc(new Date(entry.downloadedAt).toLocaleString())}</span></div><button class="b" data-download-history="${index}">Download again</button></article>`).join('')}</div>`:'<p class="hint">Downloads started from this tool or saved media will appear here.</p>';
 $('#main').innerHTML=`<section class="download-tool"><h2>Download from a URL</h2><p class="hint">Enter a public webpage, image, or video URL. Grabit will list media URLs exposed by the page and offer direct downloads when the server can access them. Supported XHamster/XHOfficial creator video lists are scanned with yt-dlp, up to 500 videos.</p><form class="download-url-form" id="downloadUrlForm"><input class="in" id="downloadUrlInput" type="url" required maxlength="2048" autocomplete="url" placeholder="https://example.com/gallery" value="${esc(V.downloadUrl)}" aria-label="URL to find downloadable media"><button class="b p" type="submit"${V.downloadError==='loading'?' disabled':''}>${V.downloadError==='loading'?'Finding media…':'Find media'}</button></form>${V.downloadError&&V.downloadError!=='loading'?`<p class="download-error" role="alert">${esc(V.downloadError)}</p>`:''}${content}</section><section class="download-history-section"><div class="download-history-heading"><h2>Download history</h2><button class="b" data-clear-downloads${records.length?'':' disabled'}>Clear history</button></div>${history}</section>`;
}
async function discoverDownloads(){
 const input=$('#downloadUrlInput'),url=validUrl(input?.value||'');
 if(!url){V.downloadError='Enter a valid public HTTP or HTTPS URL.';renderDownloadHistory();return}
 V.downloadUrl=url.href;V.downloadError='loading';V.downloadPreview=null;renderDownloadHistory();
 try{
  let page;
  const kind=classify(url.href);
  if(kind==='image'||kind==='video')page={title:host(url.href),media:[{type:kind,url:url.href,thumbnailUrl:kind==='image'?url.href:''}]};
  else page=await previewUrl(url.href);
  const media=(Array.isArray(page.media)?page.media:[]).filter(entry=>entry&&typeof entry.url==='string').sort((a,b)=>(Number(b.width||0)*Number(b.height||0))-(Number(a.width||0)*Number(a.height||0)));
  V.downloadPreview={title:page.title||host(url.href),media,truncated:!!page.truncated,warning:page.mediaWarning||page.previewWarning||''};
  V.downloadError='';
  renderDownloadHistory();
 }catch(error){
  V.downloadError=error.message||'Could not inspect this URL.';
  renderDownloadHistory();
 }
}
async function installGrabit(){
 if(V.installPrompt){
  await V.installPrompt.prompt();
  const choice=await V.installPrompt.userChoice;
  V.installPrompt=null;
  toast(choice.outcome==='accepted'?'Grabit app installation started.':'Grabit app installation was dismissed.');
  return;
 }
 if(matchMedia('(display-mode: standalone)').matches||navigator.standalone){toast('Grabit is already installed.');return}
 const isApple=/iphone|ipad|ipod/i.test(navigator.userAgent);
 toast(isApple?'To install, use Share, then Add to Home Screen.':'Use your browser menu and choose Install app or Add to Home screen.');
}
function embedPage(url,data){
 const page={url,canonicalUrl:data.canonicalUrl||normalized(url),title:data.title||host(url),description:data.description||'',media:Array.isArray(data.media)?data.media:[],refetchOnOpen:data.refetchOnOpen===true,mediaWarning:data.mediaWarning||'',previewWarning:data.previewWarning||'',truncated:!!data.truncated,playlistPaging:videoCollectionTitle(url)!=='',playlistStart:Number.isSafeInteger(data.start)?data.start:1,playlistHasMore:data.hasMore===true};
 const embed=socialMediaEmbed(url);
 if(embed&&!(embed.type==='video'&&page.media.filter(media=>media.type==='video').length>1)){
  const sourceMedia=page.media.find(media=>media.type===embed.type)||page.media.find(media=>media.type==='image')||page.media.find(media=>media.type==='video');
  const thumbnail=page.media.find(media=>media.type==='image')?.url||page.media.find(media=>media.type==='video')?.thumbnailUrl||fallbackThumbnail(embed.type);
  const embeddedMedia={type:embed.type,url,sourceUrl:url,embedUrl:embed.url,thumbnailUrl:thumbnail,downloadUrl:sourceMedia?.url||'',alt:page.title};
  if(embed.type==='video'){
   page.media=[embeddedMedia];
   return page;
  }
  page.media=page.media.filter(media=>media.type!=='video'&&media.url!==thumbnail);
  page.media.unshift(embeddedMedia);
 }
 return page;
}
async function extractPageForWatch(url){
 const kind=classify(url);
 if(kind==='image'||kind==='video')return{url,canonicalUrl:normalized(url),title:host(url),description:'',media:[{type:kind,url,thumbnailUrl:kind==='image'?url:fallbackThumbnail('video')}]};
 if(socialMediaEmbed(url)){
  try{return embedPage(url,await previewUrl(url))}
  catch(error){console.warn(`Could not preview social-media URL ${url}; using its provider embed instead.`,error);return embedPage(url,{canonicalUrl:normalized(url),title:host(url),description:'',media:[]})}
 }
 return embedPage(url,await previewUrl(url));
}
async function loadWatchPage(item){
 const watch=V.watch;if(!watch||watch.itemId!==item.id||watch.loading)return;
 watch.loading=true;watch.extractionAttempted=true;renderWatchPage(false,'Loading page media…');
 try{
  const savedPages=Array.isArray(item.sourcePages)?item.sourcePages:[];
  const urls=Array.isArray(item.sourceUrls)&&item.sourceUrls.length?item.sourceUrls:[item.sourceUrl];
  const pages=[];
  for(let index=0;index<urls.length;index++){
   const url=urls[index];if(!url||!validUrl(url))continue;
   const saved=savedPages.find(page=>normalized(page.url)===normalized(url));
   if(saved?.extracted&&!saved.refetchOnOpen){pages.push({...saved,index,media:(saved.media||[]).map(media=>({...media,type:media.type||'image',sourceUrl:media.sourceUrl||media.url||'',position:media.position||0,pageIndex:index}))});continue}
   try{pages.push({...await extractPageForWatch(url),index,extracted:true})}
   catch(error){
    const cachedMedia=saved?.media||[];
    pages.push({...saved,url,canonicalUrl:saved?.canonicalUrl||normalized(url),title:saved?.title||host(url),description:saved?.description||'',media:cachedMedia,index,extracted:cachedMedia.length>0,...(cachedMedia.length?{mediaWarning:`Could not refresh this video list: ${error.message}`}:{error:error.message})});
   }
  }
  if(!pages.length)throw new Error('No valid page URLs are saved for this item.');
  item.sourcePages=pages.map((page,index)=>({...page,index,media:page.media.map((media,position)=>({...media,type:media.type||'image',sourceUrl:media.url||media.sourceUrl||'',position:media.position??position,pageIndex:index,thumbnailUrl:media.thumbnailUrl||''}))}));
  item.media=item.sourcePages.flatMap(page=>page.media);
  if(item.type==='bookmark'&&item.media.length===1&&item.media[0].type==='video'&&V.watch?.itemId===item.id)V.watch.mediaIndex=0;
  if(!item.thumbnailUrl||item.thumbnailUrl.startsWith('data:image/svg+xml,')||(item.hiddenMediaUrls||[]).includes(item.thumbnailUrl))item.thumbnailUrl=defaultThumbnail(item);
  item.updatedAt=new Date().toISOString();await storeItem(item);await refreshLibrary();
  if(V.watch?.itemId===item.id){V.watch.loading=false;renderWatchPage(false);if(item.sourcePages.some(page=>page.error))toast('Some URLs could not be previewed; use the URL controls to continue or retry.')}
 }catch(error){console.error('Could not load saved page media:',error);if(V.watch?.itemId===item.id){V.watch.loading=false;V.watch.retrying=true;renderWatchPage(false,`Could not fetch this page's media: ${error.message}`)}}
}
async function loadPlaylistBatch(item,page,start){
 const watch=V.watch;if(!watch||watch.loading)return;
 const pages=Array.isArray(item.sourcePages)&&item.sourcePages.length?item.sourcePages:[page];
 item.sourcePages=pages;
 const sourcePage=pages[page.index]||page;
 watch.loading=true;renderWatchPage(false,`Loading videos ${start}–${Math.min(start+9,500)}…`);
 try{
  const result=await previewUrl(sourcePage.url,{start});
  const videos=result.media.filter(media=>media.type==='video');
  if(!videos.length)throw new Error('No videos were returned for this playlist page.');
  const known=new Set(sourcePage.media.map(media=>media.sourceUrl));
  sourcePage.media.push(...videos.map((media,index)=>({
   ...media,
   sourceUrl:media.sourceUrl||media.url,
   position:start-1+index,
   pageIndex:sourcePage.index
  })).filter(media=>!known.has(media.sourceUrl)));
  sourcePage.playlistStart=start;sourcePage.playlistHasMore=result.hasMore===true;sourcePage.playlistHasMoreByStart={...(sourcePage.playlistHasMoreByStart||{}),[start]:result.hasMore===true};sourcePage.mediaWarning=result.mediaWarning||'';
  item.media=item.sourcePages.flatMap(source=>source.media);
  item.thumbnailUrl=item.thumbnailUrl||sourcePage.media.find(media=>media.thumbnailUrl)?.thumbnailUrl||fallbackThumbnail('playlist');
  item.updatedAt=new Date().toISOString();await storeItem(item);await refreshLibrary();
  watch.mediaIndex=-1;watch.showingHidden=false;watch.scrollTop=0;watch.loading=false;syncWatchUrl();renderWatchPage(true);
 }catch(error){
  watch.loading=false;renderWatchPage();toast(`Could not load videos ${start}–${Math.min(start+9,500)}: ${error.message}`);
 }
}
async function changePlaylistBatch(item,page,start){
 if(start>=1&&start<=500&&page.media.some(media=>media.position>=start-1&&media.position<start+9)){
  page.playlistStart=start;page.playlistHasMore=page.playlistHasMoreByStart?.[start]??page.media.some(media=>media.position>=start+9);
  item.updatedAt=new Date().toISOString();
  try{await storeItem(item);await refreshLibrary()}catch(error){reportError('Could not save playlist position',error);return}
  V.watch.mediaIndex=-1;V.watch.showingHidden=false;V.watch.scrollTop=0;syncWatchUrl();renderWatchPage(true);
  return;
 }
 if(start>=1&&start<=500)await loadPlaylistBatch(item,page,start);
}
function watchMediaTile(item,media,index){
 const hidden=(item.hiddenMediaUrls||[]).includes(media.sourceUrl);
 const poster=media.thumbnailUrl|| (media.type==='image'?media.sourceUrl:fallbackThumbnail('video'));
 const visual=hidden?`<span class="hidden-media-placeholder" aria-hidden="true">${media.type==='video'?'Hidden video':'Hidden image'}</span>`:media.embedUrl?`<img src="${esc(poster)}" alt="" loading="lazy"><span class="play-mark" aria-hidden="true">${media.type==='video'?'▶':'↗'}</span>`:media.type==='video'?`<video src="${esc(mediaSource(media))}" poster="${esc(poster)}" muted playsinline preload="none" tabindex="-1"></video><span class="play-mark" aria-hidden="true">▶</span>`:`<img src="${esc(mediaSource(media))}" alt="${esc(media.alt||item.title)}" loading="lazy" decoding="async">`;
 const ratio=media.width&&media.height?Number(media.height)/Number(media.width):media.type==='video'?0.75:1;
 return`<div class="watch-tile-wrap${hidden?' hidden-media':''}" data-ratio="${Number.isFinite(ratio)&&ratio>0?ratio:1}"><button class="watch-tile" data-watch-media="${index}" aria-label="${hidden?`Hidden ${media.type} ${index+1}`:`Open ${media.type} ${index+1}`}"${hidden?' disabled':''}>${visual}</button><button class="watch-actions-toggle" data-watch-menu aria-label="Show media actions" aria-haspopup="menu" aria-expanded="false">${icon(icons.more)}</button><div class="watch-actions-menu" role="menu"><button class="watch-hide-button" role="menuitem" data-watch-hide="${esc(media.sourceUrl)}">${icon(icons.hide)}<span>${hidden?`Unhide ${media.type}`:`Hide ${media.type}`}</span></button>${hidden?'':downloadButton(item,media,`${icon(icons.download)}<span>Download</span>`,'watch-download-button media-download-button','menuitem')}</div></div>`;
}
function layoutWatchGrid(grid){
 const style=getComputedStyle(grid),columns=style.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,gap=parseFloat(style.columnGap)||12,width=(grid.clientWidth-gap*(columns-1))/columns,heights=Array(columns).fill(0);
 grid.querySelectorAll('.watch-tile-wrap').forEach(tile=>{
  tile.style.position='absolute';tile.style.aspectRatio='';
  const image=tile.querySelector('img'),video=tile.querySelector('video');
  const ratio=image?.naturalWidth&&image?.naturalHeight?image.naturalHeight/image.naturalWidth:video?.videoWidth&&video?.videoHeight?video.videoHeight/video.videoWidth:Number(tile.dataset.ratio)||1;
  const column=heights.indexOf(Math.min(...heights)),height=width*ratio;
  tile.style.left=`${column*(width+gap)}px`;tile.style.top=`${heights[column]}px`;tile.style.width=`${width}px`;tile.style.height=`${height}px`;
  heights[column]+=height+gap;
 });
 grid.style.height=`${Math.max(0,...heights)-gap}px`;
}
function renderWatchPage(pushScroll=false,message=''){
 const watch=V.watch;if(!watch)return;
 const item=V.items.find(entry=>entry.id===watch.itemId);
 $('#win').classList.add('watch-mode');$('#main').classList.add('full-viewer');
 const main=$('#main'),savedScroll=pushScroll?watch.scrollTop:main.scrollTop;
 if(!item){main.classList.remove('focused-view');main.innerHTML=`<div class="watch-error"><p>This saved item is no longer available.</p><button class="b" data-watch-action="back">Back to library</button></div>`;return}
 const pages=sourcePages(item);watch.pageIndex=Math.max(0,Math.min(watch.pageIndex,pages.length-1));const page=pages[watch.pageIndex],media=watchPageMedia(item,page);
 const hiddenUrls=new Set(item.hiddenMediaUrls||[]),hiddenMedia=media.map((entry,index)=>({entry,index})).filter(({entry})=>hiddenUrls.has(entry.sourceUrl));
 const feedMedia=media.map((entry,index)=>({entry,index})).filter(({entry})=>!hiddenUrls.has(entry.sourceUrl));
 const displayedMedia=watch.showingHidden?hiddenMedia:feedMedia;
 watch.mediaIndex=Math.max(-1,Math.min(watch.mediaIndex,media.length-1));const active=watch.mediaIndex>=0?media[watch.mediaIndex]:null;
 const activeHidden=!!active&&(item.hiddenMediaUrls||[]).includes(active.sourceUrl);
 const shouldShowGallery=!active&&(['gallery','playlist'].includes(item.type)||(media.length>1&&['image','video'].includes(item.type)));
 main.classList.toggle('focused-view',!!active&&!shouldShowGallery);
 main.classList.toggle('library-image-view',item.type==='image'&&!!active&&!shouldShowGallery);
 const pageTitle=page.title||item.title||host(page.url);
 const pageControls=page.playlistPaging
  ?`<div class="watch-page-buttons"><button class="watch-page-button" data-watch-action="previousPlaylistBatch" aria-label="Previous 10 videos" title="Previous 10 videos"${page.playlistStart<=1?' disabled':''}>${icon('M15 18l-6-6 6-6')}</button><button class="watch-page-button" data-watch-action="nextPlaylistBatch" aria-label="Next 10 videos" title="Next 10 videos"${!page.playlistHasMore?' disabled':''}>${icon('M9 18l6-6-6-6')}</button></div>`
  :pages.length>1?`<div class="watch-page-buttons"><button class="watch-page-button" data-watch-action="previousPage" aria-label="Previous URL" title="Previous URL"${watch.pageIndex===0?' disabled':''}>${icon('M15 18l-6-6 6-6')}</button><button class="watch-page-button" data-watch-action="nextPage" aria-label="Next URL" title="Next URL"${watch.pageIndex===pages.length-1?' disabled':''}>${icon('M9 18l6-6-6-6')}</button></div>`:'';
 const controls=pageControls?`<div class="watch-controls has-page-navigation">${pageControls}</div>`:'';
 const hasGallery=['gallery','playlist'].includes(item.type)||media.length>1;
 const backAction=active&&hasGallery?'showGrid':'back';
 const backTarget=active&&hasGallery?'media gallery':'library';
 const navigation=`<header class="watch-header"><button class="b watch-back-button" data-watch-action="${backAction}" aria-label="Back to ${backTarget}"><svg class="watch-back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>${active&&hasGallery?'Gallery':'Library'}</span></button><div class="watch-heading"><strong>${esc(item.title)}</strong><span>${pages.length>1?`URL ${watch.pageIndex+1} of ${pages.length} · `:''}${esc(pageTitle)}</span></div>${controls}</header>`;
 let content='';
 if(message)content=`<div class="watch-message">${esc(message)}${item.sourceUrl?`<p><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original webpage</a></p>`:''}<button class="b" data-watch-action="retry">Retry</button></div>`;
 else if(active&&!shouldShowGallery)content=`<div class="watch-stage" data-swipe><button class="b watch-arrow previous" data-watch-action="previousMedia" aria-label="Previous photo"${watch.mediaIndex===0?' disabled':''}>‹</button><div class="watch-stage-content">${activeHidden?`<span class="hidden-media-placeholder">${active.type==='video'?'Hidden video':'Hidden image'}</span>`:active.embedUrl?`<iframe src="${esc(active.embedUrl)}" title="${esc(active.alt||pageTitle)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`:active.type==='video'?`<video controls autoplay playsinline preload="metadata" poster="${esc(active.thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(active))}">Video playback is unavailable in this browser.</video>`:`<img class="watch-active-image${watch.mediaDirection==='next'?' slide-from-right':watch.mediaDirection==='previous'?' slide-from-left':''}" src="${esc(mediaSource(active))}" alt="${esc(active.alt||pageTitle)}">`}</div><button class="b watch-arrow next" data-watch-action="nextMedia" aria-label="Next photo"${watch.mediaIndex===media.length-1?' disabled':''}>›</button></div><div class="watch-stage-caption"><span>${watch.mediaIndex+1} / ${media.length}</span>${activeHidden?`<button class="b" data-watch-hide="${esc(active.sourceUrl)}">Unhide ${active.type}</button>`:active.type==='image'?'':`${downloadButton(item,active)}<button class="b" data-watch-hide="${esc(active.sourceUrl)}">Hide ${active.type}</button>`}</div>`;
 else if(page.error&&!media.length)content=`<div class="watch-message">Could not load this URL: ${esc(page.error)}<p><a href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">Open original webpage</a></p><button class="b" data-watch-action="retry">Retry</button></div>`;
 else if(media.length)content=`<div class="watch-page-info"><span>${esc(pageTitle)} · ${watch.showingHidden?`${hiddenMedia.length} hidden items`:`${feedMedia.length} items`}</span>${page.url?`<a href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">Open original</a>`:''}${hiddenMedia.length||watch.showingHidden?`<button class="watch-hidden-toggle" data-watch-action="${watch.showingHidden?'showGalleryFeed':'showHiddenMedia'}">${watch.showingHidden?'Back to gallery':`Hidden items (${hiddenMedia.length})`}</button>`:''}</div>${[page.mediaWarning,page.previewWarning,page.truncated?'Only the first 500 media items are shown.':''].filter(Boolean).map(warning=>`<p class="hint" role="status">${esc(warning)}</p>`).join('')}${displayedMedia.length?`<div class="watch-grid">${displayedMedia.map(({entry,index})=>watchMediaTile(item,entry,index)).join('')}</div>`:`<div class="watch-message">${watch.showingHidden?'There are no hidden media on this URL.':'No visible media. Open Hidden items to manage hidden media.'}</div>`}`;
 else content=`<div class="watch-message">${esc(message||'No images or videos were found on this page.')}${page.url?`<p><a href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">Open original webpage</a></p>`:''}</div>`;
 delete watch.mediaDirection;
 V.watchResizeObserver?.disconnect();V.watchResizeObserver=null;
 const viewerBackdrop=active?.type==='image'&&!activeHidden?`<img class="watch-viewer-backdrop" src="${esc(mediaSource(active))}" alt="" aria-hidden="true">`:'';
 main.innerHTML=`${viewerBackdrop}${navigation}<div class="watch-content${active?' focused-media-view':''}">${content}</div>`;
 const pageInfo=main.querySelector('.watch-page-info > span');
 if(page.playlistPaging&&pageInfo)pageInfo.textContent=`${pageTitle} · Videos ${page.playlistStart}–${page.playlistStart+media.length-1} · ${watch.showingHidden?`${hiddenMedia.length} hidden items`:`${feedMedia.length} items`}`;
 const watchHeader=main.querySelector('.watch-header');
 if(watchHeader){watchHeader.classList.toggle('header-hidden',!active&&!!watch.headerHidden);main.style.setProperty('--watch-header-height',`${watchHeader.offsetHeight}px`)}
 const watchGrid=main.querySelector('.watch-grid');
 if(watchGrid){
  const updateLayout=()=>layoutWatchGrid(watchGrid);
  updateLayout();
  watchGrid.querySelectorAll('img').forEach(image=>image.addEventListener('load',updateLayout,{once:true}));
  V.watchResizeObserver=new ResizeObserver(updateLayout);V.watchResizeObserver.observe(watchGrid);
 }
 main.scrollTop=savedScroll;watch.scrollTop=savedScroll;
 if(message&&message.startsWith('Could not fetch')&&watch.retrying)return;
 const sourceNeedsRefresh=!!item.sourcePages?.some(page=>page.refetchOnOpen);
 if((sourceNeedsRefresh||!(item.type==='image'||item.type==='video'&&item.media?.length))&&!message&&!watch.extractionAttempted&&(!item.sourcePages?.length||item.sourcePages.some(page=>!page.extracted||page.refetchOnOpen))&&!watch.loading)loadWatchPage(item);
}
function mediaTile(item,media,index){
 const source=mediaSource(media),hidden=(item.hiddenMediaUrls||[]).includes(media.sourceUrl);const visual=hidden
  ?`<span class="hidden-media-placeholder" aria-hidden="true">${media.type==='video'?'Hidden video':'Hidden image'}</span>`
  :media.type==='video'
  ?media.embedUrl?`<img src="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" alt="" loading="lazy" decoding="async"><span class="play-mark" aria-hidden="true">▶</span>`:`<video src="${esc(source)}" poster="${esc(media.thumbnailUrl||fallbackThumbnail('video'))}" muted playsinline preload="none" tabindex="-1"></video><span class="play-mark" aria-hidden="true">▶</span>`
  :media.embedUrl?`<img src="${esc(media.thumbnailUrl||fallbackThumbnail('social'))}" alt="" loading="lazy" decoding="async"><span class="play-mark" aria-hidden="true">↗</span>`:`<img src="${esc(source)}" alt="${esc(item.title)} — image ${index+1}" loading="lazy" decoding="async">`;
 return `<div class="media-tile ${media.type==='video'?'video-tile':''}${hidden?' hidden':''}">
 <button class="media-open" data-action="openMedia" data-index="${index}" aria-label="${hidden?`Hidden ${media.type} ${index+1} of ${item.media.length}`:`Open ${media.type} ${index+1} of ${item.media.length}`}"${hidden?' disabled':''}>${visual}<span class="media-number">${index+1}</span></button>
 ${!hidden&&downloadUrl(media)?downloadButton(item,media):''}
 <button class="media-menu-button" data-media-menu aria-label="Media options" aria-haspopup="menu" aria-expanded="false">${icon(icons.more)}</button>
 <div class="media-menu" role="menu"><button role="menuitem" data-media-visibility="${esc(media.sourceUrl)}">${hidden?`Unhide ${media.type}`:`Hide ${media.type}`}</button></div></div>`;
}
function libraryImageViewer(item,image,index,total,backAction){
 const source=esc(mediaSource(image));
 return `<div class="library-image-viewer"><img class="library-image-backdrop" src="${source}" alt="" aria-hidden="true"><button class="library-image-back" data-action="${backAction}" aria-label="${backAction==='backToGallery'?'Back to image gallery':'Close image viewer'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>${total>1?`<button class="library-image-arrow previous" data-action="mediaPrev" aria-label="Previous image">‹</button>`:''}<div class="library-image-content"><img src="${source}" alt="${esc(item.title)} — image ${index+1}"></div>${total>1?`<button class="library-image-arrow next" data-action="mediaNext" aria-label="Next image">›</button>`:''}<span class="library-image-counter">${index+1} / ${total}</span></div>`;
}
function renderItemViewer(item){
 V.dialogMode='view';const media=viewerMedia(item);if(V.mediaIndex>=media.length)V.mediaIndex=media.length-1;const focused=V.mediaIndex>=0?media[V.mediaIndex]:null;
 const focusedHidden=focused&&(item.hiddenMediaUrls||[]).includes(focused.sourceUrl);
 const shouldShowGallery=!focused&&(['gallery','playlist'].includes(item.type)||(media.length>1&&['image','video'].includes(item.type)));
 let display='',imageViewMode=false;
 if(focused&&!shouldShowGallery){
  if(focusedHidden)display=`<div class="hidden-media-view"><span class="hidden-media-placeholder">${focused.type==='video'?'Hidden video':'Hidden image'}</span></div><div class="row"><button class="b" data-media-visibility="${esc(focused.sourceUrl)}">Unhide ${focused.type}</button>${media.length>1?'<button class="b" data-action="backToGallery">Back to gallery</button>':''}</div>`;
  else if(focused.type==='image'&&!focused.embedUrl){imageViewMode=true;display=libraryImageViewer(item,focused,V.mediaIndex,media.length,'backToGallery')}
  else display=`<div class="focus-media">${focused.embedUrl?`<iframe src="${esc(focused.embedUrl)}" title="${esc(item.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`:focused.type==='video'?`<video controls autoplay playsinline preload="metadata" poster="${esc(focused.thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(focused))}">Video playback is unavailable in this browser.</video>`:`<img src="${esc(mediaSource(focused))}" alt="${esc(item.title)} — image ${V.mediaIndex+1}">`}</div><div class="bar media-navigation"><button class="b" data-action="mediaPrev" aria-label="Previous media">‹ Previous</button><span>${V.mediaIndex+1} / ${media.length}</span><button class="b" data-action="mediaNext" aria-label="Next media">Next ›</button></div><div class="row">${downloadButton(item,focused)}<button class="b" data-media-visibility="${esc(focused.sourceUrl)}">${(item.hiddenMediaUrls||[]).includes(focused.sourceUrl)?'Unhide':'Hide'} this media</button><button class="b" data-action="backToGallery">Back to ${item.type==='playlist'?'playlist':'gallery'}</button></div>`;
 }else if(shouldShowGallery||(!focused&&['gallery','playlist'].includes(item.type))){
  const hiddenUrls=new Set(item.hiddenMediaUrls||[]),galleryMedia=media.map((entry,index)=>({entry,index})).filter(({entry})=>hiddenUrls.has(entry.sourceUrl)===V.showingHiddenMedia);
  display=`${hiddenUrls.size||V.showingHiddenMedia?`<div class="row between"><span class="hint">${V.showingHiddenMedia?`${galleryMedia.length} hidden items`:`${media.length-galleryMedia.length} visible items`}</span><button class="watch-hidden-toggle" data-action="toggleHiddenList">${V.showingHiddenMedia?'Back to gallery':`Hidden items (${hiddenUrls.size})`}</button></div>`:''}<div class="media-grid">${galleryMedia.map(({entry,index})=>mediaTile(item,entry,index)).join('')||`<p class="hint">${V.showingHiddenMedia?'No hidden media in this gallery.':'No visible media in this gallery.'}</p>`}</div>`;
 }else if(item.type==='video'&&media[0]){
  const hidden=(item.hiddenMediaUrls||[]).includes(media[0].sourceUrl);
  display=hidden?`<div class="hidden-media-view"><span class="hidden-media-placeholder">Hidden video</span></div><div class="row"><button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">Unhide video</button></div>`:`<div class="focus-media">${media[0].embedUrl?`<iframe src="${esc(media[0].embedUrl)}" title="${esc(item.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`:`<video controls autoplay playsinline preload="metadata" poster="${esc(media[0].thumbnailUrl||fallbackThumbnail('video'))}" src="${esc(mediaSource(media[0]))}">Video playback is unavailable in this browser.</video>`}</div><div class="row">${downloadButton(item,media[0])}<button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">Hide this video</button></div>`;
 }else if(item.type==='image'&&media[0]){
  if((item.hiddenMediaUrls||[]).includes(media[0].sourceUrl))display=`<div class="hidden-media-view"><span class="hidden-media-placeholder">Hidden image</span></div><div class="row"><button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">Unhide image</button></div>`;
  else if(media[0].type==='image'&&!media[0].embedUrl){imageViewMode=true;display=libraryImageViewer(item,media[0],0,1,'close')}
  else display=`<div class="focus-media"><img src="${esc(mediaSource(media[0]))}" alt="${esc(item.title)}"></div><div class="row">${downloadButton(item,media[0])}<button class="b" data-media-visibility="${esc(media[0].sourceUrl)}">${(item.hiddenMediaUrls||[]).includes(media[0].sourceUrl)?'Unhide':'Hide'} this image</button></div>`;
 }else if(item.type==='bookmark'){
  const thumbnail=thumbUrl(item);
  display=thumbnail?`<div class="bookmark-preview"><img src="${esc(thumbnail)}" alt=""></div>`:'<div class="bookmark-preview bookmark-fallback" aria-hidden="true">WEB</div>';
 }
 const details=`<div class="viewer-copy"><h2>${esc(item.title)}</h2>${item.sourceDomain?`<div class="source">${esc(item.sourceDomain)}</div>`:''}${item.sourceUrl&&validUrl(item.sourceUrl)?`<button class="b" data-action="openSource" data-url="${esc(item.sourceUrl)}">Open original</button>`:''}${item.description?`<p>${esc(item.description)}</p>`:''}${item.notes?`<p class="viewer-notes">${esc(item.notes)}</p>`:''}${item.tags?.length?`<div class="tag-list">${item.tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}</div>`;
 show(imageViewMode?display:`<div class="viewer-head"><div><span class="bd-inline">${esc(item.type)}${['gallery','playlist'].includes(item.type)?` · ${media.length} ${item.type==='playlist'?'videos':'images'}`:''}</span></div><button class="ib" data-action="close" aria-label="Close viewer">×</button></div>${display}${details}`,true);
 if(imageViewMode)$('#md').classList.add('image-view-mode');
}
function editItem(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;
 V.dialogItemId=id;V.dialogMode='edit';const media=orderedMedia(item);
 const preview=thumbUrl(item);
 const thumbnailValue=item.thumbnailUrl?.startsWith('data:image/')?'':item.thumbnailUrl||'';
 show(`<h2>Edit content</h2>${preview?`<div class="pv"><img src="${esc(preview)}" alt="Current thumbnail"></div>`:''}
 <label for="detailTitle">Title</label><input class="in" id="detailTitle" maxlength="240" value="${esc(item.title)}">
 <label for="detailDescription">Description</label><textarea class="in" id="detailDescription" maxlength="3000">${esc(item.description||'')}</textarea>
 <label for="detailNotes">Personal notes</label><textarea class="in" id="detailNotes" maxlength="10000">${esc(item.notes||'')}</textarea>
 <label for="detailTags">Tags (comma separated)</label><input class="in" id="detailTags" value="${esc((item.tags||[]).join(', '))}">
 ${item.type!=='note'?`<label for="detailThumb">Custom thumbnail URL (optional)</label><input class="in" id="detailThumb" type="url" placeholder="https://…" value="${esc(thumbnailValue)}">`:''}
 <label for="detailSource">Source URL</label><input class="in" id="detailSource" type="url" value="${esc(item.sourceUrl||'')}">
 ${['gallery','playlist'].includes(item.type)?`<label for="mediaUrls">Media URLs (one per line; order is preserved)</label><textarea class="in" id="mediaUrls">${esc(media.map(m=>m.sourceUrl||m.storedDataUrl||'').join('\n'))}</textarea>`:''}
 <label>Sections (uncheck all to return to Inbox)</label><div id="detailSections">${sectionOptions(item.sectionIds||[])}</div>
 <label class="checklist"><input id="detailHideFromAll" type="checkbox"${item.hiddenFromAll?' checked':''}> Hide from All content (keep it in its section)</label>
 <label class="checklist"><input id="detailFavorite" type="checkbox"${item.isFavorite?' checked':''}> Favorite</label>
 <div class="row"><button class="b p" data-action="saveItem" data-id="${esc(item.id)}">Save changes</button><button class="b" data-action="cancelEdit" data-id="${esc(item.id)}">Cancel</button></div>`,true);
}
function selectedSections(root){const destination=root.querySelector('select[name="destination"]');return destination?(destination.value?[destination.value]:[]):[...root.querySelectorAll('input[name="section"]:checked')].map(x=>x.value)}
function parseTags(value){return [...new Set(value.split(',').map(t=>t.trim()).filter(Boolean))]}
async function saveImports(){
 const urls=[...new Set($('#urls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];if(!urls.length){toast('Enter at least one URL.');return}
 const valid=[];const invalid=[];for(const raw of urls){const u=validUrl(raw);if(u)valid.push(u.href);else invalid.push(raw)}
 const chosen=selectedSections($('#importSections'));const title=$('#importTitle').value.trim();const description=$('#importDescription').value.trim();
 const duplicates=[];const unique=[];const seen=new Set();
 for(const url of valid){const key=normalized(url);const existing=V.items.find(i=>i.canonicalUrl===key&&!i.isArchived);if(existing||seen.has(key))duplicates.push({url,existing});else{unique.push(url);seen.add(key)}}
 const pending={valid,invalid,chosen,title,description,duplicates,unique};
 if(duplicates.length){V.pendingImport=pending;const first=duplicates.find(x=>x.existing);show(`<b>Possible duplicate${duplicates.length===1?'':'s'} found</b><p>${duplicates.length} URL(s) already exist or repeat in this batch. Choose what to do; nothing is silently merged.</p><div class="row">${first?`<button class="b" data-action="openDuplicate" data-id="${esc(first.existing.id)}">Open existing item</button>`:''}<button class="b" data-action="continueImport" data-mode="skip">Skip duplicates</button><button class="b" data-action="continueImport" data-mode="section"${chosen.length?'':' disabled'}>Add existing items to selected section(s)</button><button class="b p" data-action="continueImport" data-mode="save">Save duplicates anyway</button><button class="b" data-action="close">Cancel</button></div>`);return}
 await continueImport(pending,'skip');
}
async function continueImport(pending,mode){
 const {valid,invalid,chosen,title,description,duplicates,unique}=pending;
 if(mode==='section'&&chosen.length){for(const {existing}of duplicates){if(!existing)continue;existing.sectionIds=[...new Set([...(existing.sectionIds||[]),...chosen])];existing.inbox=false;existing.updatedAt=new Date().toISOString();await storeItem(existing)}}
 const work=mode==='save'?valid:unique;if(!work.length){await refreshLibrary();hide();render();toast(`No new URLs saved. ${duplicates.length} duplicate(s) skipped; ${invalid.length} invalid URL(s).`);return}
 const videoCollections=work.filter(url=>videoCollectionTitle(url));
 const otherUrls=work.filter(url=>!videoCollectionTitle(url));
 const kinds=otherUrls.map(classify);let saved=0;const errors=[];
 const saveButton=$('#saveImportButton');
 if(saveButton){saveButton.disabled=true;saveButton.textContent=videoCollections.length?'Fetching playlist…':'Saving…'}
 V.preview=null;
 try{
  for(const url of videoCollections){
   try{
    const preview=await previewUrl(url),videos=preview.media.filter(media=>media.type==='video');
    if(!videos.length)throw new Error(`No videos were found in the creator list ${url}.`);
    const canonicalUrl=preview.canonicalUrl||normalized(url);
    const matchingItems=V.items.filter(item=>item.canonicalUrl===canonicalUrl||normalized(item.sourceUrl)===canonicalUrl||item.sourceUrls?.some(source=>normalized(source)===canonicalUrl));
    const hiddenMediaUrls=[...new Set(matchingItems.flatMap(item=>item.hiddenMediaUrls||[]))];
    const hidden=new Set(hiddenMediaUrls);
    const media=videos.map(({url:mediaUrl,...entry},position)=>({
     ...entry,
     sourceUrl:entry.sourceUrl||mediaUrl,
     hidden:hidden.has(entry.sourceUrl||mediaUrl),
     position:entry.position??position,
     pageIndex:0
    }));
    const page={url,canonicalUrl,title:preview.title||videoCollectionTitle(url),description:preview.description||'',index:0,extracted:true,refetchOnOpen:false,playlistPaging:videoCollectionTitle(url)!=='',playlistStart:preview.start||1,playlistHasMore:preview.hasMore===true,playlistHasMoreByStart:{[preview.start||1]:preview.hasMore===true},truncated:!!preview.truncated,mediaWarning:preview.mediaWarning||'',media};
    const item=emptyItem({type:'playlist',title:work.length===1&&title?title:page.title,description:work.length===1?description:page.description,sourceUrl:url,media,thumbnailUrl:media.find(entry=>entry.thumbnailUrl&&!hidden.has(entry.sourceUrl))?.thumbnailUrl||fallbackThumbnail('playlist'),sectionIds:chosen});
    item.canonicalUrl=canonicalUrl;item.sourceUrls=[url];item.sourcePages=[page];item.hiddenMediaUrls=hiddenMediaUrls;
    await storeItem(item);saved++;
   }catch(error){errors.push(`${url}: ${error.message}`)}
  }
  if(otherUrls.length>1&&kinds.every(kind=>kind==='image'||kind==='video')){
   const media=otherUrls.map((url,position)=>({type:kinds[position],sourceUrl:url,thumbnailUrl:kinds[position]==='image'?url:fallbackThumbnail('video'),position,pageIndex:position}));
   const pages=otherUrls.map((url,index)=>({url,canonicalUrl:normalized(url),title:host(url)||url,description:'',index,extracted:true,media:[media[index]]}));
   const type=kinds.every(kind=>kind==='video')?'playlist':'gallery';
   const item=emptyItem({type,title:title||(type==='playlist'?'Video playlist':'Image gallery'),description,sourceUrl:otherUrls[0],media,thumbnailUrl:media.find(entry=>entry.type==='image')?.sourceUrl||media[0].thumbnailUrl,sectionIds:chosen});
   item.sourceUrls=otherUrls;item.sourcePages=pages;await storeItem(item);saved++;
  }else if(otherUrls.length>1&&kinds.includes('bookmark')){
   const pages=otherUrls.map((url,index)=>({url,canonicalUrl:normalized(url),title:host(url)||url,description:'',index,extracted:false,media:[]}));
   const item=emptyItem({type:'bookmark',title:title||'Saved webpages',description,sourceUrl:otherUrls[0],thumbnailUrl:fallbackThumbnail('bookmark'),sectionIds:chosen});
   item.sourceUrls=otherUrls;item.sourcePages=pages;await storeItem(item);saved++;
  }else{
   for(let index=0;index<otherUrls.length;index++){
    try{const url=otherUrls[index],kind=kinds[index],media=kind==='bookmark'?[]:[{type:kind,sourceUrl:url,position:0}];const item=emptyItem({type:kind,title:otherUrls.length===1&&title?title:host(url)||url,description:otherUrls.length===1?description:'',sourceUrl:url,media,thumbnailUrl:kind==='image'?url:'',sectionIds:chosen});await storeItem(item);saved++}
    catch(error){errors.push(`${otherUrls[index]}: ${error.message}`)}
   }
  }
  await refreshLibrary();hide();render();const skipped=mode==='save'?0:duplicates.length;
  toast(`${saved} ${saved===1?'entry':'entries'} saved${skipped?`; ${skipped} duplicate(s) skipped`:''}${invalid.length?`; ${invalid.length} invalid URL(s)`:''}${errors.length?`; ${errors.length} failed`:''}.`);
  if(invalid.length)console.warn('Invalid URLs skipped:',invalid);if(errors.length)console.error('Some URLs could not be saved:',errors);
 }catch(error){if(saveButton?.isConnected){saveButton.disabled=false;saveButton.textContent='Save URL(s)'}reportError('Could not save imported URLs',error)}
}
async function saveNote(){
 const title=$('#noteTitle').value.trim(),notes=$('#noteText').value.trim();if(!title&&!notes){toast('Add a title or note text first.');return}
 try{await storeItem(emptyItem({type:'note',title:title||'Untitled note',notes,tags:parseTags($('#noteTags').value),sectionIds:selectedSections($('#bx'))}));await refreshLibrary();hide();render();toast('Note saved.')}catch(e){reportError('Could not save note',e)}
}
async function saveImages(){
 const files=[...($('#imageFiles')?.files||[]),...(V.droppedFiles||[])];if(!files.length){toast('Choose or drop at least one image.');return}
 const sections=selectedSections($('#bx'));let count=0;const errors=[];
 for(const file of files){try{const image=await imageFile(file);await storeItem(emptyItem({type:'image',title:file.name.replace(/\.[^.]+$/,''),media:[{type:'image',sourceUrl:'',storedDataUrl:image.data,width:image.width,height:image.height}],thumbnailUrl:image.data,sectionIds:sections}));count++}catch(e){errors.push(`${file.name}: ${e.message}`)}}
 V.droppedFiles=[];await refreshLibrary();hide();render();toast(`${count} image(s) saved${errors.length?`; ${errors.length} failed`:''}.`);if(errors.length)console.warn('Image import errors:',errors);
}
async function saveDetail(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;
 const source=$('#detailSource').value.trim();if(source&&!validUrl(source)){toast('Source URL must use http or https.');return}
 const thumb=item.type==='note'?'':$('#detailThumb').value.trim();if(thumb&&!validUrl(thumb)){toast('Thumbnail URL must use http or https.');return}
 let media=item.media||[];
 if(['gallery','playlist'].includes(item.type)){
  const lines=$('#mediaUrls').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length){toast('A gallery or playlist must contain at least one media URL.');return}
  if(lines.some(x=>!validUrl(x))){toast('Every media URL must use http or https.');return}
  media=lines.map((url,position)=>({...media.find(m=>m.sourceUrl===url)||{},id:media.find(m=>m.sourceUrl===url)?.id||uid(),type:item.type==='gallery'?'image':'video',sourceUrl:url,storedDataUrl:undefined,position}));
 }
 const sourceChanged=source!==item.sourceUrl;item.title=$('#detailTitle').value.trim()||item.title;item.description=$('#detailDescription').value.trim();item.notes=$('#detailNotes').value.trim();item.tags=parseTags($('#detailTags').value);item.thumbnailUrl=item.type==='note'?'':thumb||media.find(m=>m.storedDataUrl)?.storedDataUrl||media.find(m=>m.type==='image')?.sourceUrl||'';item.sourceUrl=source;item.canonicalUrl=normalized(source);item.sourceDomain=host(source);if(['image','video'].includes(item.type)&&media[0]&&sourceChanged)media[0].sourceUrl=source;item.media=media;item.sectionIds=selectedSections($('#detailSections'));item.inbox=item.sectionIds.length===0;item.hiddenFromAll=Boolean($('#detailHideFromAll').checked&&item.sectionIds.length);item.isFavorite=$('#detailFavorite').checked;item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();if(V.watch?.itemId===id){hide();renderWatchPage()}else renderItemViewer(V.items.find(x=>x.id===id));toast('Changes saved.')}catch(e){reportError('Could not save changes',e)}
}
async function toggleFavorite(id){
 const item=V.items.find(x=>x.id===id);if(!item)return;item.isFavorite=!item.isFavorite;item.updatedAt=new Date().toISOString();
 try{await storeItem(item);await refreshLibrary();render()}catch(e){reportError('Could not update favorite',e)}
}
async function bulk(action,confirmed=false){
 const items=V.items.filter(i=>V.selected.has(i.id));if(!items.length){toast('Select at least one item.');return}
 let sectionId='';
 if(action==='section'){sectionId=$('#bulkSection').value;if(!sectionId){toast('Choose a section first.');return}}
 if((action==='archive'||action==='delete')&&!confirmed){V.pendingBulkAction=action;show(`<b>${action==='delete'?'Delete selected content':'Archive selected content'}</b><p>${action==='delete'?`Permanently delete ${items.length} selected item(s)? This cannot be undone.`:`Archive ${items.length} selected item(s)?`}</p><div class="row"><button class="b d" data-action="confirmBulk">${action==='delete'?'Delete permanently':'Archive items'}</button><button class="b" data-action="close">Cancel</button></div>`);return}
 if(action==='tag'){show(`<b>Edit tags for ${items.length} item(s)</b><label for="bulkTagAction">Action</label><select class="in" id="bulkTagAction"><option value="add">Add tag</option><option value="remove">Remove tag</option></select><label for="bulkTagName">Tag</label><input class="in" id="bulkTagName" maxlength="80"><div class="row"><button class="b p" data-action="applyBulkTag">Apply</button><button class="b" data-action="close">Cancel</button></div>`);return}
 if(action==='favorite'){const shouldFavorite=!items.every(i=>i.isFavorite);for(const item of items)item.isFavorite=shouldFavorite}
 try{
  for(const item of items){
   if(action==='inbox'){item.sectionIds=[];item.inbox=true}
   if(action==='section'){item.sectionIds=[sectionId];item.inbox=false}
   if(action==='addTag'&&!item.tags.some(t=>t.toLowerCase()===V.bulkTag.toLowerCase()))item.tags.push(V.bulkTag);
   if(action==='removeTag')item.tags=item.tags.filter(t=>t.toLowerCase()!==V.bulkTag.toLowerCase());
   if(action==='archive')item.isArchived=true;
   if(action==='delete'){await removeItem(item.id);continue}
   item.updatedAt=new Date().toISOString();await storeItem(item);
  }
  V.selected.clear();await refreshLibrary();render();toast(`${items.length} item(s) updated.`);
 }catch(e){reportError('Could not update selected items',e)}
}
function downloadJson(){
 const data=libraryExportData();
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`grabit-library-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Library export downloaded.');
}
function libraryExportData(){
 return{format:'grabit-library',version:1,exportedAt:new Date().toISOString(),storage:'metadata and local image data only; external media files are referenced by URL',sections:V.sections,items:V.items};
}
function exportDialog(){
 show(`<b>Export library</b><p class="hint">Share a compressed link or download JSON. Anyone with the link can read it; large libraries may need JSON.</p><div class="row"><button class="b p" data-action="createShareLink">Create share link</button><button class="b" data-action="downloadExport">Download JSON</button><button class="b" data-action="restoreDialog">Import…</button><button class="b" data-action="close">Close</button></div><div id="shareLinkOutput" hidden><label for="shareLinkValue">Share link</label><textarea class="in" id="shareLinkValue" rows="4" readonly></textarea><div class="row"><button class="b" data-action="copyShareLink">Copy link</button></div></div>`);
}
function restoreDialog(){
 show(`<b>Import library</b><p class="hint">Existing items stay; duplicates are skipped.</p><label for="shareLinkInput">Share link</label><textarea class="in" id="shareLinkInput" rows="2" placeholder="Paste a Grabit share link"></textarea><div class="row"><button class="b p" data-action="importShareLink">Import share link</button></div><label for="restoreFile">JSON backup</label><input class="in" id="restoreFile" type="file" accept="application/json,.json"><div class="row"><button class="b" data-action="restore">Import JSON backup</button><button class="b" data-action="exportDialog">Back</button></div>`);
}
function confirmLibraryRestore(data,source){
 V.pendingBackup=data;
 show(`<b>Import ${esc(source)}</b><p>Import ${data.items.length} item(s) and ${data.sections.length} section(s)? Existing items stay; duplicates are skipped.</p><div class="row"><button class="b p" data-action="confirmRestore">Import library</button><button class="b" data-action="close">Cancel</button></div>`);
}
async function createShareLink(){
 const button=$('[data-action="createShareLink"]');
 if(button){button.disabled=true;button.textContent='Preparing link…'}
 try{
  const link=await createLibraryShareLink(libraryExportData(),location.href);
  const output=$('#shareLinkOutput'),field=$('#shareLinkValue');
  if(!output||!field)return;
  field.value=link;output.hidden=false;
  try{await navigator.clipboard.writeText(link);toast('Share link created and copied. Anyone with it can read your library.')}
  catch(error){console.warn('Grabit could not copy the share link automatically:',error);field.focus();field.select();toast('Share link created. Copy it from the field above.')}
 }catch(error){console.error('Could not create a library share link:',error);toast(error.message||'Could not create a share link.')}
 finally{if(button?.isConnected){button.disabled=false;button.textContent='Create share link'}}
}
async function copyShareLink(){
 const field=$('#shareLinkValue');if(!field?.value){toast('Create a share link first.');return}
 try{await navigator.clipboard.writeText(field.value);toast('Share link copied. Anyone with it can read your library.')}
 catch(error){console.warn('Grabit could not copy the share link automatically:',error);field.focus();field.select();toast('Copy the selected share link.')}
}
async function importShareLink(){
 const value=$('#shareLinkInput')?.value.trim();if(!value){toast('Paste a Grabit share link first.');return}
 try{confirmLibraryRestore(await readLibraryShareLink(value),'shared library')}
 catch(error){console.error('Could not read the library share link:',error);toast(error.message||'Could not read the share link.')}
}
async function restoreBackup(){
 const file=$('#restoreFile').files[0];if(!file){toast('Choose a JSON backup file.');return}if(file.size>30*1024*1024){toast('Backup files must be smaller than 30 MB.');return}
 let data;try{data=JSON.parse(await file.text())}catch{toast('This file is not valid JSON.');return}
 if(data?.format!=='grabit-library'||data.version!==1||!Array.isArray(data.items)||!Array.isArray(data.sections)){toast('This is not a supported Grabit library backup.');return}
 confirmLibraryRestore(data,'JSON backup');
}
async function commitRestore(){
 const data=V.pendingBackup;if(!data)return;V.pendingBackup=null;
 let added=0,duplicates=0;const sectionMap=new Map();
 try{
  for(const section of data.sections){if(!section||typeof section.name!=='string'||typeof section.id!=='string')continue;let existing=V.sections.find(s=>s.id===section.id||s.name.toLowerCase()===section.name.toLowerCase());if(!existing){existing={...section,position:V.sections.length};await storeSection(existing);V.sections.push(existing)}sectionMap.set(section.id,existing.id)}
  await refreshLibrary();
  for(const item of data.items){
   if(!item||typeof item.id!=='string'||typeof item.title!=='string'||!['bookmark','note','image','video','gallery','playlist'].includes(item.type)||!Array.isArray(item.media)||!Array.isArray(item.tags)||!Array.isArray(item.sectionIds))continue;
   if(item.sourceUrl&&!validUrl(item.sourceUrl))continue;
   if(item.media.some(m=>m.sourceUrl&&!validUrl(m.sourceUrl)&&!m.storedDataUrl))continue;
   if(item.canonicalUrl&&V.items.some(x=>x.canonicalUrl===item.canonicalUrl)){duplicates++;continue}
   const sectionIds=item.sectionIds.map(oldId=>sectionMap.get(oldId)).filter(Boolean);const now=new Date().toISOString();
   await storeItem({...item,id:V.items.some(x=>x.id===item.id)?uid():item.id,sectionIds,inbox:sectionIds.length===0,savedAt:now,updatedAt:now});added++;
  }
  await refreshLibrary();hide();render();toast(`Restored ${added} item(s); skipped ${duplicates} duplicate(s) or invalid record(s).`);
 }catch(e){reportError('Restore stopped; some earlier records may already have been added',e)}
}
function reportError(message,error){console.error(message,error);toast(`${message}: ${error?.message||'unexpected storage error'}`)}
async function manageDelete(id){
 const section=V.sections.find(s=>s.id===id);if(!section)return;
 const count=V.items.filter(i=>(i.sectionIds||[]).includes(id)).length;
 show(`<b>Delete "${esc(section.name)}"?</b><p>${count?`This section contains ${count} item(s). Choose whether to keep them in Inbox or delete them too.`:'This section is empty.'}</p><div class="row">${count?`<button class="b p" data-action="deleteSectionContents" data-id="${esc(id)}" data-mode="inbox">Delete section; move items to Inbox</button><button class="b d" data-action="deleteSectionContents" data-id="${esc(id)}" data-mode="delete">Delete section and items</button>`:`<button class="b d" data-action="deleteSectionContents" data-id="${esc(id)}" data-mode="inbox">Delete section</button>`}<button class="b" data-action="close">Cancel</button></div>`);
}
async function deleteSectionContents(id,mode){
 const items=V.items.filter(i=>(i.sectionIds||[]).includes(id));
 try{if(mode==='delete')for(const item of items)await removeItem(item.id);await removeSection(id);await refreshLibrary();V.view='all';V.sectionId=null;hide();render();toast(mode==='delete'?'Section and items deleted.':'Section deleted; items moved to Inbox.')}catch(e){reportError('Could not delete section',e)}
}
$('#add').addEventListener('click',addDialog);
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light',true));
$('#sbt').addEventListener('click',()=>{const win=$('#win');matchMedia('(max-width:760px)').matches?win.classList.toggle('open'):win.classList.toggle('hide')});
$('#scrim').addEventListener('click',()=>$('#win').classList.remove('open'));
document.addEventListener('click',e=>{if(e.target.closest('.card-menu-button,.card-menu'))return;closeCardMenus()});
let searchTimer;$('#q').addEventListener('input',e=>{V.q=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(render,180)});
$('#md').addEventListener('click',async e=>{
 if(e.target.id==='md')return;
 const visibility=e.target.closest('[data-media-visibility]');
 if(visibility){await toggleMediaVisibility(V.dialogItemId,visibility.dataset.mediaVisibility);return}
 const mediaMenu=e.target.closest('[data-media-menu]');
 if(mediaMenu){e.stopPropagation();const tile=mediaMenu.closest('.media-tile'),menu=mediaMenu.nextElementSibling,open=!menu.classList.contains('open');$('#bx').querySelectorAll('.media-menu.open').forEach(el=>{el.classList.remove('open');el.closest('.media-tile')?.classList.remove('menu-open')});$('#bx').querySelectorAll('[data-media-menu]').forEach(el=>el.setAttribute('aria-expanded','false'));menu.classList.toggle('open',open);tile.classList.toggle('menu-open',open);mediaMenu.setAttribute('aria-expanded',String(open));return}
 const previewHide=e.target.closest('[data-preview-hide]');
 if(previewHide&&V.preview){const page=V.preview.pages[Number(previewHide.dataset.previewPage)],url=previewHide.dataset.previewHide;if(page.hiddenUrls.has(url)){page.hiddenUrls.delete(url);page.selected.add(url)}else{page.hiddenUrls.add(url);page.selected.delete(url)}previewPanel();return}
 const button=e.target.closest('[data-action]');if(!button)return;
 const action=button.dataset.action,id=button.dataset.id;
 if(action==='close')hide();
 else if(action==='createSection')await saveNewSection();
 else if(action==='importDialog')importDialog();
 else if(action==='noteDialog')noteDialog();
 else if(action==='uploadDialog')uploadDialog();
 else if(action==='import')await saveImports();
 else if(action==='saveImport'){if(V.preview)await savePreview();else await saveImports()}
 else if(action==='previewPage')await previewPage();
 else if(action==='savePreview')await savePreview();
 else if(action==='toggleHiddenPreview'){if(V.preview){V.preview.showHidden=!V.preview.showHidden;previewPanel()}}
 else if(action==='toggleHiddenList'){V.showingHiddenMedia=!V.showingHiddenMedia;V.mediaIndex=-1;const item=V.items.find(entry=>entry.id===V.dialogItemId);if(item)renderItemViewer(item)}
 else if(action==='saveNote')await saveNote();
 else if(action==='saveImages')await saveImages();
 else if(action==='saveItem')await saveDetail(id);
 else if(action==='editItem')editItem(id);
 else if(action==='cancelEdit'){if(V.watch?.itemId===id){hide();renderWatchPage()}else detail(id)}
 else if(action==='openMedia'){V.mediaIndex=Number(button.dataset.index);const item=V.items.find(x=>x.id===V.dialogItemId);if(item)renderItemViewer(item)}
 else if(action==='backToGallery'){V.mediaIndex=-1;const item=V.items.find(x=>x.id===V.dialogItemId);if(item)renderItemViewer(item)}
 else if(action==='toggleViewerFavorite'){await toggleFavorite(id);const item=V.items.find(x=>x.id===id);if(item)renderItemViewer(item)}
 else if(action==='continueImport'){const pending=V.pendingImport;V.pendingImport=null;if(pending)await continueImport(pending,button.dataset.mode)}
 else if(action==='openDuplicate'){const existing=V.items.find(item=>item.id===id);V.pendingImport=null;if(existing){hide();V.mediaIndex=0;detail(id)}}
 else if(action==='confirmBulk'){const bulkAction=V.pendingBulkAction;V.pendingBulkAction=null;hide();if(bulkAction)await bulk(bulkAction,true)}
 else if(action==='applyBulkTag'){const tag=$('#bulkTagName').value.trim();if(!tag){toast('Enter a tag name.');return}const next=$('#bulkTagAction').value;V.bulkTag=tag;hide();await bulk(next==='add'?'addTag':'removeTag',true)}
 else if(action==='confirmRestore')await commitRestore();
 else if(action==='deleteSectionContents')await deleteSectionContents(id,button.dataset.mode);
 else if(action==='confirmDeleteItem'){try{await removeItem(id);await refreshLibrary();hide();render();toast('Item deleted.')}catch(err){reportError('Could not delete item',err)}}
 else if(action==='cancelDeleteItem'){detail(id)}
 else if(action==='mediaPrev'||action==='mediaNext'){const item=V.items.find(x=>x.id===V.dialogItemId);if(item){const length=viewerMedia(item).length;V.mediaIndex=(V.mediaIndex+(action==='mediaPrev'?-1:1)+length)%length;renderItemViewer(item)}}
 else if(action==='downloadExport')downloadJson();
 else if(action==='createShareLink')await createShareLink();
 else if(action==='copyShareLink')await copyShareLink();
 else if(action==='importShareLink')await importShareLink();
 else if(action==='exportDialog')exportDialog();
 else if(action==='restoreDialog')restoreDialog();
 else if(action==='restore')await restoreBackup();
 else if(action==='openSource'){const url=validUrl(button.dataset.url);if(url)window.open(url.href,'_blank','noopener,noreferrer')}
 else if(action==='archive'){const item=V.items.find(x=>x.id===id);if(!item)return;item.isArchived=!item.isArchived;item.updatedAt=new Date().toISOString();try{await storeItem(item);await refreshLibrary();hide();render();toast(item.isArchived?'Archived.':'Restored from archive.')}catch(err){reportError('Could not update archive status',err)}}
 else if(action==='deleteItem'){show(`<b>Delete this item?</b><p>This permanently removes it from this browser library. This cannot be undone.</p><div class="row"><button class="b d" data-action="confirmDeleteItem" data-id="${esc(id)}">Delete permanently</button><button class="b" data-action="cancelDeleteItem" data-id="${esc(id)}">Cancel</button></div>`,true)}
 else if(action==='saveSection'){const section=V.sections.find(s=>s.id===id),name=$('#sectionName').value.trim();if(!name){toast('Section name cannot be empty.');return}if(V.sections.some(s=>s.id!==id&&s.name.toLowerCase()===name.toLowerCase())){toast('A section with that name already exists.');return}section.name=name;section.description=$('#sectionDescription').value.trim();section.updatedAt=new Date().toISOString();try{await storeSection(section);await refreshLibrary();hide();render();toast('Section updated.')}catch(err){reportError('Could not update section',err)}}
 else if(action==='deleteSection')manageDelete(id);
});
$('#md').addEventListener('change',e=>{
 if(e.target.matches('[data-preview-select]')&&V.preview){const page=V.preview.pages[Number(e.target.dataset.previewPage)],url=e.target.dataset.previewSelect;e.target.checked?page.selected.add(url):page.selected.delete(url);previewPanel()}
 if(e.target.id==='mediaKind'&&V.preview){V.preview=null;$('#extractionPreview').innerHTML='';const saveButton=$('#saveImportButton');if(saveButton)saveButton.textContent='Save URL(s)'}
});
$('#md').addEventListener('input',e=>{
 if(e.target.id==='urls'&&V.preview){V.preview=null;$('#extractionPreview').innerHTML='';const saveButton=$('#saveImportButton');if(saveButton)saveButton.textContent='Save URL(s)'}
});
$('#main').addEventListener('click',async e=>{
 const actionToggle=e.target.closest('[data-watch-menu]');
 if(actionToggle){const tile=actionToggle.closest('.watch-tile-wrap'),menu=tile.querySelector('.watch-actions-menu'),open=!tile.classList.contains('show-actions');document.querySelectorAll('.watch-tile-wrap.show-actions').forEach(item=>{item.classList.remove('show-actions');item.querySelector('.watch-actions-menu')?.classList.remove('align-left');item.querySelector('[data-watch-menu]')?.setAttribute('aria-expanded','false')});tile.classList.toggle('show-actions',open);if(open)menu.classList.toggle('align-left',tile.getBoundingClientRect().left<innerWidth/2);actionToggle.setAttribute('aria-expanded',String(open));return}
 if(!e.target.closest('.watch-tile-wrap.show-actions'))document.querySelectorAll('.watch-tile-wrap.show-actions').forEach(item=>{item.classList.remove('show-actions');item.querySelector('.watch-actions-menu')?.classList.remove('align-left');item.querySelector('[data-watch-menu]')?.setAttribute('aria-expanded','false')});
 const discovered=e.target.closest('[data-discovery-download]');
 if(discovered){const media=V.downloadPreview?.media[Number(discovered.dataset.discoveryDownload)];if(media&&!media.embedUrl)await downloadMedia(media.url,{title:V.downloadPreview.title,type:media.type,thumbnailUrl:media.thumbnailUrl||''});return}
 const downloadButton=e.target.closest('[data-download-url],[data-download-local]');
 if(downloadButton){
  const actionMenu=downloadButton.closest('.watch-actions-menu');
  if(actionMenu){const tile=actionMenu.closest('.watch-tile-wrap');tile.classList.remove('show-actions');actionMenu.classList.remove('align-left');tile.querySelector('[data-watch-menu]')?.setAttribute('aria-expanded','false')}
  const local=downloadButton.dataset.downloadLocal?V.items.find(item=>item.id===downloadButton.dataset.downloadItem)?.media.find(media=>media.id===downloadButton.dataset.downloadLocal)?.storedDataUrl:'';
  await downloadMedia(downloadButton.dataset.downloadUrl||local,{itemId:downloadButton.dataset.downloadItem,title:downloadButton.dataset.downloadTitle,type:downloadButton.dataset.downloadType,thumbnailUrl:downloadButton.dataset.downloadThumb});return;
 }
 const downloadHistory=e.target.closest('[data-download-history]');
 if(downloadHistory){const record=V.downloads[Number(downloadHistory.dataset.downloadHistory)];if(record)await downloadMedia(record.url,{itemId:record.itemId,title:record.title,type:record.type,thumbnailUrl:record.thumbnailUrl});return}
 if(e.target.closest('[data-clear-downloads]')){V.downloads=[];storeDownloadHistory();render();return}
 const watchButton=e.target.closest('[data-watch-action]');
 if(watchButton&&V.watch&&['previousPlaylistBatch','nextPlaylistBatch'].includes(watchButton.dataset.watchAction)){
  const item=V.items.find(entry=>entry.id===V.watch.itemId),page=item?.sourcePages?.[V.watch.pageIndex];
  if(item&&page?.playlistPaging){
   const start=page.playlistStart||1;
   await changePlaylistBatch(item,page,start+(watchButton.dataset.watchAction==='nextPlaylistBatch'?10:-10));
  }
  return;
 }
 if(watchButton&&V.watch){const action=watchButton.dataset.watchAction,item=V.items.find(entry=>entry.id===V.watch.itemId);if(action==='back'){V.watch=null;syncWatchUrl();$('#win').classList.remove('watch-mode');$('#main').classList.remove('full-viewer','focused-view');render();return}if(action==='edit'&&item){editItem(item.id);return}if(action==='retry'&&item){item.sourcePages=null;item.media=[];V.watch.loading=false;V.watch.retrying=false;V.watch.extractionAttempted=false;loadWatchPage(item);return}if(action==='showHiddenMedia'||action==='showGalleryFeed'){V.watch.showingHidden=action==='showHiddenMedia';V.watch.mediaIndex=-1;renderWatchPage();return}if(action==='previousPage'||action==='nextPage'){const count=sourcePages(item).length;V.watch.pageIndex=Math.max(0,Math.min(count-1,V.watch.pageIndex+(action==='previousPage'?-1:1)));V.watch.mediaIndex=-1;V.watch.showingHidden=false;V.watch.scrollTop=0;syncWatchUrl();renderWatchPage(true);return}if(action==='previousMedia'||action==='nextMedia'){const page=sourcePages(item)[V.watch.pageIndex],media=watchPageMedia(item,page);V.watch.mediaIndex=Math.max(0,Math.min(media.length-1,V.watch.mediaIndex+(action==='previousMedia'?-1:1)));V.watch.mediaDirection=action==='nextMedia'?'next':'previous';syncWatchUrl();renderWatchPage();return}if(action==='showGrid'){V.watch.mediaIndex=-1;delete V.watch.mediaDirection;syncWatchUrl();renderWatchPage();return}}
 const watchHide=e.target.closest('[data-watch-hide]');if(watchHide&&V.watch){await toggleMediaVisibility(V.watch.itemId,watchHide.dataset.watchHide);return}
 const watchMediaButton=e.target.closest('[data-watch-media]');
 if(watchMediaButton&&V.watch){V.watch.mediaIndex=Number(watchMediaButton.dataset.watchMedia);V.watch.scrollTop=$('#main').scrollTop;syncWatchUrl();renderWatchPage();return}
 const menuButton=e.target.closest('[data-card-menu]');if(menuButton){e.stopPropagation();const cardEl=menuButton.closest('.card'),menu=cardEl.querySelector('.card-menu'),open=!menu.classList.contains('open');closeCardMenus();if(open){menu.classList.add('open');cardEl.classList.add('menu-open');menuButton.setAttribute('aria-expanded','true');positionCardMenu(menu,menuButton)}return}
 const cardAction=e.target.closest('[data-card-action]');if(cardAction){e.stopPropagation();const id=cardAction.dataset.id,action=cardAction.dataset.cardAction,item=V.items.find(entry=>entry.id===id);if(!item)return;
  const menu=cardAction.closest('.card-menu');if(menu)closeCardMenus();
  if(action==='edit'){editItem(id);return}
  if(action==='favorite'){await toggleFavorite(id);return}
  if(action==='allVisibility'){item.hiddenFromAll=!item.hiddenFromAll;item.updatedAt=new Date().toISOString();try{await storeItem(item);await refreshLibrary();render();toast(item.hiddenFromAll?'Hidden from All content.':'Shown in All content.')}catch(error){reportError('Could not update All content visibility',error)}return}
  if(action==='archive'){item.isArchived=!item.isArchived;item.updatedAt=new Date().toISOString();try{await storeItem(item);await refreshLibrary();render();toast(item.isArchived?'Archived.':'Restored from archive.')}catch(error){reportError('Could not update archive status',error)}return}
  if(action==='delete'){show(`<b>Delete this item?</b><p>This permanently removes it from this browser library. This cannot be undone.</p><div class="row"><button class="b d" data-action="confirmDeleteItem" data-id="${esc(id)}">Delete permanently</button><button class="b" data-action="cancelDeleteItem" data-id="${esc(id)}">Cancel</button></div>`,true);return}
 }
 if(e.target.closest('#selectMode')){V.selectMode=true;render();return}
 const bulkButton=e.target.closest('[data-bulk]');if(bulkButton){const action=bulkButton.dataset.bulk;if(action==='done'){V.selectMode=false;V.selected.clear();render()}else if(action==='selectAll'){matchingItems().forEach(i=>V.selected.add(i.id));render()}else await bulk(action);return}
 const select=e.target.closest('[data-select]');if(select){e.stopPropagation();select.checked?V.selected.add(select.dataset.select):V.selected.delete(select.dataset.select);return}
 if(e.target.closest('.card-menu'))return;
 const cardEl=e.target.closest('.card');if(cardEl){if(V.selectMode){V.selected.has(cardEl.dataset.id)?V.selected.delete(cardEl.dataset.id):V.selected.add(cardEl.dataset.id);render()}else{V.mediaIndex=0;detail(cardEl.dataset.id)}}
});
$('#main').addEventListener('submit',event=>{if(event.target.id==='downloadUrlForm'){event.preventDefault();discoverDownloads()}});
$('#main').addEventListener('scroll',()=>{
 document.querySelectorAll('.card-menu.open').forEach(menu=>{menu.classList.remove('open');menu.style.removeProperty('--menu-left');menu.style.removeProperty('--menu-top');menu.closest('.card')?.classList.remove('menu-open');menu.previousElementSibling?.setAttribute('aria-expanded','false')});
 if(!V.watch)return;
 const scrollTop=$('#main').scrollTop,previous=V.watch.lastScrollTop??scrollTop,delta=scrollTop-previous;
 V.watch.scrollTop=scrollTop;
 if(V.watch.mediaIndex<0){if(scrollTop<12)V.watch.headerHidden=false;else if(delta>6)V.watch.headerHidden=true;else if(delta< -6)V.watch.headerHidden=false;$('#main .watch-header')?.classList.toggle('header-hidden',V.watch.headerHidden)}
 V.watch.lastScrollTop=scrollTop;
 clearTimeout(V.watchScrollTimer);V.watchScrollTimer=setTimeout(()=>syncWatchUrl(),180);
});
addEventListener('resize',closeCardMenus);
$('#main').addEventListener('touchstart',event=>{if(V.watch&&V.watch.mediaIndex>=0&&event.target.closest('[data-swipe]')){const touch=event.changedTouches[0];V.watch.touchStart={x:touch.clientX,y:touch.clientY}}},{passive:true});
$('#main').addEventListener('touchend',event=>{if(!V.watch||V.watch.mediaIndex<0||!V.watch.touchStart)return;const touch=event.changedTouches[0],deltaX=touch.clientX-V.watch.touchStart.x,deltaY=touch.clientY-V.watch.touchStart.y;delete V.watch.touchStart;if(Math.abs(deltaX)<55||Math.abs(deltaX)<Math.abs(deltaY)*1.2)return;const action=deltaX<0?'nextMedia':'previousMedia';$(`[data-watch-action="${action}"]:not(:disabled)`)?.click()},{passive:true});
addEventListener('popstate',()=>{
 if(!new URLSearchParams(location.search).has('watch'))try{sessionStorage.removeItem('grabit-watch-route')}catch(error){console.warn('Grabit could not clear the saved viewer position:',error)}
 if(readWatchRoute())renderWatchPage(true);else render();
});
$('#main').addEventListener('change',async e=>{
 if(e.target.id==='typeFilter'){V.type=e.target.value;render()}
 if(e.target.id==='sortOrder'){V.sort=e.target.value;render()}
 if(e.target.id==='bulkSection'&&e.target.value)await bulk('section');
 if(e.target.matches('[data-select]')){e.target.checked?V.selected.add(e.target.dataset.select):V.selected.delete(e.target.dataset.select)}
});
$('#nav').addEventListener('click',e=>{
 if(e.target.closest('#addSection')){createSection();return}
 if(e.target.closest('#installApp')){installGrabit();return}
 if(e.target.closest('#exportLibrary')){exportDialog();return}
 const manage=e.target.closest('[data-manage-section]');if(manage){manageSection(manage.dataset.manageSection);return}
 const item=e.target.closest('[data-view]');if(!item)return;
 V.view=item.dataset.view;V.sectionId=item.dataset.section||null;V.tag=null;V.selectMode=false;V.selected.clear();V.q='';$('#q').value='';$('#win').classList.remove('open');render();
});
$('#nav').addEventListener('dblclick',e=>{const item=e.target.closest('[data-view="section"]');if(item)manageSection(item.dataset.section)});
$('#nav').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-view]')){e.preventDefault();e.target.click()}});
addEventListener('keydown',e=>{
 if(e.key==='Escape'&&$('#md').classList.contains('on')){if(V.dialogMode==='edit')toast('Save or cancel your edits before closing.');else hide()}
 if(e.key==='Escape'&&!$('#md').classList.contains('on')){const actions=$('.watch-tile-wrap.show-actions');if(actions){actions.classList.remove('show-actions');actions.querySelector('.watch-actions-menu')?.classList.remove('align-left');const toggle=actions.querySelector('[data-watch-menu]');toggle?.setAttribute('aria-expanded','false');toggle?.focus()}else{const menu=$('.card-menu.open');if(menu){menu.classList.remove('open');menu.previousElementSibling?.setAttribute('aria-expanded','false');menu.previousElementSibling?.focus()}}}
 if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$('#q').focus()}
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card'))e.target.click();
 if(V.watch&&V.watch.mediaIndex>=0&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){if(e.key==='ArrowLeft'){$('[data-watch-action="previousMedia"]:not(:disabled)')?.click()}if(e.key==='ArrowRight'){$('[data-watch-action="nextMedia"]:not(:disabled)')?.click()}}
 const item=V.items.find(i=>i.id===V.dialogItemId);
 if($('#md').classList.contains('on')&&V.dialogMode==='view'&&item&&['gallery','playlist'].includes(item.type)&&V.mediaIndex>=0&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){
  if(e.key==='ArrowLeft'){$('[data-action="mediaPrev"]')?.click()}
  if(e.key==='ArrowRight'){$('[data-action="mediaNext"]')?.click()}
 }
});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('beforeinstallprompt',event=>{event.preventDefault();V.installPrompt=event});
addEventListener('appinstalled',()=>{V.installPrompt=null;toast('Grabit was installed successfully.')});
document.addEventListener('error',e=>{const image=e.target;if(!(image instanceof HTMLImageElement)||image.dataset.fallbackApplied)return;image.dataset.fallbackApplied='true';image.src=fallbackThumbnail(image.closest('.card')?.querySelector('.bd')?.textContent||'media')},{capture:true});
addEventListener('drop',e=>{e.preventDefault();const dropped=[...e.dataTransfer.files],files=dropped.filter(file=>file.type.startsWith('image/'));if(dropped.length!==files.length)toast('Only image files can be added by drag and drop.');if(!files.length)return;V.droppedFiles=files;uploadDialog()});
async function init(){
 try{
  let theme='dark';try{theme=localStorage.getItem('grabit-theme')||theme}catch(error){console.warn('Could not read the saved theme preference:',error)}
  applyTheme(theme);loadDownloadHistory();watchForAppUpdates();await openDB();await migrateLegacy();await refreshLibrary();
  if(hasLibraryShareLink(location.href)){
   const shareUrl=location.href,url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url);
   try{confirmLibraryRestore(await readLibraryShareLink(shareUrl),'shared library')}
   catch(error){console.error('Could not open the library share link:',error);toast(error.message||'Could not open the share link.');render()}
  }else if(readWatchRoute())renderWatchPage(true);else render()
 }
 catch(error){console.error('Grabit could not start its local library:',error);$('#main').innerHTML=`<div class="empty"><b>Grabit could not open local storage.</b><p>${esc(error.message)}</p><p>Check browser storage permissions and available space, then reload.</p></div>`;$('#add').disabled=true}
}
init();
