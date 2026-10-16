import { formatInquiry } from './inquiry.js';

const q = (selector) => document.querySelector(selector);
const stroke = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
const drawings = {
  brakes: `<g transform="translate(5 0)"><ellipse cx="112" cy="87" rx="59" ry="61" fill="#d9ded3"/><ellipse cx="105" cy="82" rx="59" ry="61" ${stroke}/><ellipse cx="105" cy="82" rx="32" ry="34" ${stroke}/><ellipse cx="105" cy="82" rx="11" ry="12" ${stroke}/>${[0,60,120,180,240,300].map(a=>`<circle cx="105" cy="59" r="2.5" fill="currentColor" transform="rotate(${a} 105 82)"/><path d="M100 32v9m26-1-5 8" ${stroke} transform="rotate(${a} 105 82)"/>`).join('')}<path d="m149 43 20 13-4 51-22 11-11-20 8-39z" fill="#df4f27" stroke="#9a391e" stroke-width="2"/><path d="m147 56 12 7-4 34-12 7" fill="none" stroke="#f89a74" stroke-width="2"/></g>`,
  engine: `<path d="m62 50 68-16 52 30-69 18z" fill="#d2d8cc" ${stroke}/><path d="M62 50v52l51 30 69-18V64l-69 18zM113 82v50M70 64l33 19v31L70 95zM124 94l48-13v23l-48 13z" ${stroke}/><path d="m79 43 9-20 43-9 20 14-10 13M82 29l46-10 16 11M83 49l45-10" ${stroke}/><path d="m52 76-15 4v24l25 14M40 85l13 4M146 72V49M157 68V56" ${stroke}/><path d="m126 90 43-11v8l-43 11z" fill="#df4f27"/>`,
  suspension: `<g transform="rotate(28 120 85)"><path d="M106 16h28v14h-28z" fill="#465249"/><path d="M115 29h11v113h-11z" fill="#c7cec0" stroke="currentColor" stroke-width="2"/><path d="M108 125h26v23h-26z" fill="#df4f27"/><ellipse cx="121" cy="151" rx="14" ry="6" ${stroke}/><path d="M98 36h46M98 119h46" ${stroke}/>${Array.from({length:6},(_,i)=>`<path d="M99 ${42+i*12}c-15 4 53 10 43 15" fill="none" stroke="#465249" stroke-width="5"/>`).join('')}</g>`,
  electrical: `<g transform="rotate(-17 120 82)"><path d="M85 65h66v54H85z" fill="#d1d8cc" ${stroke}/><path d="M95 40h46v27H95zM99 34h38v8M103 21h30v13M108 12h20v9M111 119v21h14v-21M115 140v14h6v-14M85 78h66M85 106h66" ${stroke}/><path d="M95 45h46v5H95zm0 11h46v5H95z" fill="#df4f27"/><path d="m88 84 8-4 8 4 8-4 8 4 8-4 8 4 8-4M88 95l8-4 8 4 8-4 8 4 8-4 8 4 8-4" ${stroke}/></g>`,
  filters: `<path d="m82 49 53-16 38 22-53 17z" fill="#d0d7ca" ${stroke}/><path d="M82 49v62l38 22 53-17V55l-53 17v61" ${stroke}/>${Array.from({length:8},(_,i)=>`<path d="m${87+i*4} ${57+i*2.4}v53" stroke="#7d8b75" stroke-width="2"/>`).join('')}<path d="m120 78 53-17M120 126l53-17" ${stroke}/><path d="m79 49 3-7 53-16 41 25-3 7M79 110v8l41 24 56-19v-8" fill="#df4f27" stroke="#9b482c" stroke-width="2"/>`,
  motorcycle: `<g transform="translate(-3 1)"><path d="M60 100h53v23H60z" fill="#d1d9cb" ${stroke}/><path d="M71 63h35v37H71zM68 58h42v8H68z" fill="#d1d9cb" ${stroke}/><path d="M74 51h30v7M78 43h22v8" ${stroke}/>${[70,78,86,94].map(y=>`<path d="M65 ${y}h46" ${stroke}/>`).join('')}<path d="m113 105 34-28 23 8-33 32-24 6M147 77l-7-13-13 1M168 86l13 4v20l-27 12-17-5" ${stroke}/><path d="m78 43 4-19h16l6 19M88 24v-8M60 103l-14-9-8 5v17l22 7" ${stroke}/><circle cx="159" cy="100" r="8" fill="#df4f27"/><circle cx="90" cy="112" r="7" ${stroke}/></g>`,
};
const categories = [
  {title:'Braking systems',detail:'Pads, discs & brake components',vehicle:['auto','moto'],icon:'brakes'},
  {title:'Engine & transmission',detail:'Engine parts, clutches & drive components',vehicle:['auto','moto'],icon:'engine'},
  {title:'Suspension & steering',detail:'Shocks, arms & steering components',vehicle:['auto','moto'],icon:'suspension'},
  {title:'Electrical & ignition',detail:'Sensors, ignition & electrical parts',vehicle:['auto','moto'],icon:'electrical'},
  {title:'Filters & maintenance',detail:'Air filters, oil filters & service parts',vehicle:['auto','moto'],icon:'filters'},
  {title:'Motorcycle components',detail:'Drive parts, cables & accessories',vehicle:['moto'],icon:'motorcycle'},
];
const grid=q('#parts-grid');
categories.forEach((part,index)=>{
  const article=document.createElement('article');article.className='part-category';article.dataset.vehicle=part.vehicle.join(' ');
  article.innerHTML=`<div class="part-image"><span class="part-tag">${String(index+1).padStart(2,'0')} / ${part.vehicle.length>1?'AUTO + MOTO':'MOTORCYCLE'}</span><svg viewBox="0 0 240 170" aria-hidden="true">${drawings[part.icon]}</svg></div><div class="part-meta"><div><h3>${part.title}</h3><p>${part.detail}</p></div><button class="part-add" type="button" aria-label="Add ${part.title.toLowerCase()} to inquiry">+</button></div>`;
  article.querySelector('button').addEventListener('click',()=>{addPart(part.title);toast(`${part.title} added to your inquiry`);});grid.append(article);
});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-filter]').forEach(other=>{const active=other===button;other.classList.toggle('active',active);other.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('.part-category').forEach(article=>{article.hidden=button.dataset.filter!=='all'&&!article.dataset.vehicle.split(' ').includes(button.dataset.filter);});
}));
let rowId=0;
function addPart(description='') {
  const rows=q('#part-rows');
  if(rows.children.length>=30){toast('You can add up to 30 parts per inquiry.');return;}
  const empty=[...rows.children].find(row=>!row.querySelector('[data-description]').value.trim());
  if(description&&empty){empty.querySelector('[data-description]').value=description;return;}
  const id=++rowId;const row=document.createElement('div');row.className='part-row';
  row.innerHTML=`<label for="part-${id}">Part / reference<input id="part-${id}" data-description required maxlength="300" placeholder="Part name or OEM number"></label><label for="qty-${id}">Quantity<input id="qty-${id}" data-quantity type="number" min="1" max="1000000" step="1" value="1" required></label><button type="button" aria-label="Remove part ${id}">×</button>`;
  row.querySelector('[data-description]').value=description;
  row.querySelector('button').addEventListener('click',()=>{if(rows.children.length===1){row.querySelector('[data-description]').value='';row.querySelector('[data-quantity]').value='1';}else{row.remove();}});
  rows.append(row);
  if(id>1&&!description)row.querySelector('input').focus();
}
addPart();q('#add-part').addEventListener('click',()=>addPart());
document.querySelectorAll('[data-sourcing]').forEach(link=>link.addEventListener('click',()=>addPart(link.dataset.sourcing)));
const menu=q('.menu-toggle');const nav=q('#navigation');
function closeMenu(){nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation');}
menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');});
nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
window.addEventListener('scroll',()=>q('.header').classList.toggle('scrolled',window.scrollY>20),{passive:true});
let toastTimer;
function toast(message){q('#toast').textContent=message;q('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>q('#toast').classList.remove('visible'),3500);}
let inquiryText='';let site={};
q('#inquiry-form').addEventListener('submit',event=>{
  event.preventDefault();const form=new FormData(event.currentTarget);
  const data=Object.fromEntries(form.entries());data.services=form.getAll('services');
  data.parts=[...q('#part-rows').children].map(row=>({description:row.querySelector('[data-description]').value.trim(),quantity:Number(row.querySelector('[data-quantity]').value)}));
  try{inquiryText=formatInquiry(data);}catch(error){toast(error.message);return;}
  q('#inquiry-preview').textContent=inquiryText;q('#inquiry-status').textContent='';
  const email=q('#email-inquiry');email.hidden=!site.email;
  if(site.email)email.href=`mailto:${site.email}?subject=${encodeURIComponent(`Purchasing inquiry — ${data.company}`)}&body=${encodeURIComponent(inquiryText)}`;
  q('#inquiry-dialog').showModal();
});
q('#download-inquiry').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([inquiryText],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='partsbridge-purchasing-inquiry.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);q('#inquiry-status').textContent='Your file is ready. Share it with your sourcing partner; this website has not sent it.';
});
q('#copy-inquiry').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(inquiryText);q('#inquiry-status').textContent='Inquiry copied. You can paste it into your email or message.';}catch{q('#inquiry-status').textContent='Clipboard is unavailable. Select the preview text to copy it, or download the file.';}
});
document.querySelectorAll('dialog').forEach(dialog=>{dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();});});
const policies={privacy:{title:'Privacy details',content:'<h3>Your inquiry stays with you</h3><p>The inquiry builder processes your details in this browser tab. It does not submit your name, email or parts list to a server, and does not save a draft in browser storage. Reloading the page clears the draft.</p><h3>Downloads and sharing</h3><p>Downloading creates a plain text file on your device. Copying writes to your clipboard when permitted. If a business email is configured, the email action opens your own mail application; you choose whether to send.</p><h3>Website resources</h3><p>This website does not use analytics, advertising cookies or account tracking. The hosting provider may process standard access logs. Fonts are requested from Google Fonts, which receives normal connection information such as IP address.</p>'},terms:{title:'Website terms',content:'<h3>Sourcing information</h3><p>Product categories are illustrative sourcing capabilities, not a stock list or an offer to sell. Product illustrations do not establish exact specification, fitment, certification or availability.</p><h3>Confirm before ordering</h3><p>All quantities, specifications, prices, lead times, inspection arrangements, delivery terms, taxes and payment terms require separate written agreement. No payment or purchase is made on this website.</p><h3>Product suitability</h3><p>Buyers should confirm vehicle compatibility and applicable import, safety and regulatory requirements before purchasing. Inspection scope must be agreed for the individual order.</p>'}};
document.querySelectorAll('[data-policy]').forEach(button=>button.addEventListener('click',()=>{const policy=policies[button.dataset.policy];q('#policy-title').textContent=policy.title;q('#policy-content').innerHTML=policy.content;q('#policy-dialog').showModal();}));
q('#year').textContent=new Date().getFullYear();
try{
  const response=await fetch('./site.json');if(!response.ok)throw new Error('Site settings unavailable');site=await response.json();
  const contacts=q('#contact-links');
  if(site.email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.email)){const a=document.createElement('a');a.href=`mailto:${site.email}`;a.textContent='Email us ↗';contacts.append(a);}else site.email='';
  if(/^\d{7,15}$/.test(site.whatsapp||'')){const a=document.createElement('a');a.href=`https://wa.me/${site.whatsapp}`;a.textContent='WhatsApp ↗';a.target='_blank';a.rel='noopener noreferrer';contacts.append(a);}
}catch{site={};}
