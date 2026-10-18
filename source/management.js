const q=s=>document.querySelector(s);
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const notice=text=>{q('#management-status').textContent=text;};
let csrf='',categories=[],editing=null,productPage=1,inquiryPage=1;
function loggedOut(){csrf='';q('#management-workspace').hidden=true;q('#management-login').hidden=false;q('#logout').hidden=true;q('#inquiry-detail').replaceChildren();q('#product-list').replaceChildren();q('#inquiry-list').replaceChildren();q('#product-editor').reset();editing=null;}
async function api(url,{method='GET',body}={}){
  const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const d=await r.json();if(!r.ok){if(r.status===401)loggedOut();throw new Error(d.error||'Request failed. Retry.');}return d;
}
function button(text,action,outline=true){const b=node('button',text,`button${outline?' button-outline':''}`);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await action();}catch(error){notice(error.message);}finally{b.disabled=false;}});return b;}
function table(headers,rows){const wrap=node('div',undefined,'management-table-wrap'),t=node('table'),thead=node('thead'),head=node('tr'),body=node('tbody');for(const label of headers)head.append(node('th',label));thead.append(head);for(const values of rows){const row=node('tr');for(const value of values){const td=node('td');if(value instanceof Node)td.append(value);else td.textContent=value;row.append(td);}body.append(row);}t.append(thead,body);wrap.append(t);return wrap;}
function pager(target,page,total,load){q(target).replaceChildren();if(page>1)q(target).append(button('Previous',()=>load(page-1)));if(page*24<total)q(target).append(button('Next',()=>load(page+1)));}
async function loadCategories(){
  ({categories}=await api('/api/categories'));
  const select=q('#product-editor').elements.categoryId,current=select.value;select.replaceChildren(new Option('Select category',''));
  for(const c of categories)select.append(new Option(c.name,c.id));select.value=current;
  q('#category-list').replaceChildren(categories.length?table(['Category','Actions'],categories.map(c=>{
    const controls=node('div',undefined,'management-actions');
    controls.append(button('Rename',async()=>{const name=prompt('Category name',c.name);if(name?.trim()){await api(`/api/admin/categories/${c.id}`,{method:'PUT',body:{name:name.trim()}});await loadCategories();notice('Category renamed.');}}),button('Delete',async()=>{if(confirm(`Delete unused category “${c.name}”?`)){await api(`/api/admin/categories/${c.id}`,{method:'DELETE',body:{}});await loadCategories();notice('Unused category deleted.');}}));return[c.name,controls];
  })):node('p','No categories yet. Add a category before creating products.'));
}
async function loadProducts(page=1){
  productPage=page;const params=new URLSearchParams({q:q('#product-search').elements.q.value,page:String(page)}),d=await api(`/api/admin/products?${params}`);
  q('#product-list').replaceChildren(d.products.length?table(['SKU / product','Category','Visibility','Actions'],d.products.map(p=>{
    const label=node('div');label.append(node('strong',p.sku),node('p',p.name));const controls=node('div',undefined,'management-actions');
    controls.append(button('Edit',()=>editProduct(p)),button('Retire',async()=>{if(confirm(`Remove ${p.sku} from the customer catalogue? Its inquiry history will remain.`)){await api(`/api/admin/products/${p.id}`,{method:'DELETE',body:{}});await loadProducts(productPage);notice('Product retired. Historical inquiry records preserved.');}}));return[label,p.category,p.active?'Published':'Retired / draft',controls];
  })):node('p','No products found. Add your real products using Add product.'));
  pager('#product-pages',page,d.total,loadProducts);
}
function editProduct(p=null){editing=p;q('#product-editor').reset();q('#product-editor-title').textContent=p?'Edit product':'Add product';if(p)for(const [key,value]of Object.entries(p)){const field=q('#product-editor').elements.namedItem(key);if(!field)continue;if(field.type==='checkbox')field.checked=value;else field.value=value;}q('#product-editor').hidden=false;q('#product-editor').elements.sku.focus();}
async function loadInquiries(page=1){
  inquiryPage=page;const params=new URLSearchParams(new FormData(q('#inquiry-search')));params.set('page',String(page));const d=await api(`/api/admin/inquiries?${params}`);
  q('#inquiry-list').replaceChildren(d.inquiries.length?table(['Reference / company','Contact','Status','Email notification','Action'],d.inquiries.map(i=>{
    const label=node('div');label.append(node('strong',i.reference),node('p',i.company),node('time',i.created_at+' UTC'));return[label,`${i.contact_name}\n${i.email}`,i.status,i.notification_status,button('Open inquiry',()=>openInquiry(i.id))];
  })):node('p','No inquiries match your search. New customer inquiries will appear here.'));
  pager('#inquiry-pages',page,d.total,loadInquiries);
}
async function openInquiry(id){
  const d=await api(`/api/admin/inquiries/${id}`),section=q('#inquiry-detail');section.replaceChildren();section.className='management-detail';
  section.append(node('h2',d.reference),node('p',`${d.contact_name} · ${d.company}\n${d.email} · ${d.phone||'No phone supplied'}\n${d.country} · ${d.business}\n${d.order_type}`));
  section.append(table(['Part / SKU','Quantity','Specifications'],d.items.map(p=>[`${p.description}\n${p.sku_snapshot||'Custom part'}`,p.quantity,p.specifications])));
  section.append(node('h3','Customer requirements'),node('p',d.notes||'No additional notes.'),node('p',`Support: ${d.services.join(', ')||'Not specified'}`));
  section.append(node('p',`Email notification: ${d.notification_status} · Attempts: ${d.notification_attempts}${d.notification_error?' · '+d.notification_error:''}${d.notification_sent_at?' · Accepted by SMTP server at '+d.notification_sent_at+' UTC':''}. SMTP acceptance does not prove inbox delivery.`));
  if(['pending','failed'].includes(d.notification_status))section.append(button('Retry email notification',async()=>{await api(`/api/admin/inquiries/${id}/retry-notification`,{method:'POST',body:{}});notice('Notification queued for another attempt.');await openInquiry(id);}));
  const form=node('form',undefined,'management-editor'),statusLabel=node('label','Inquiry status'),select=node('select');select.name='status';for(const s of ['new','reviewing','quoted','closed','spam'])select.append(new Option(s,s));select.value=d.status;statusLabel.append(select);
  const notesLabel=node('label','Internal notes'),notes=node('textarea');notes.name='adminNotes';notes.maxLength=5000;notes.rows=4;notes.value=d.admin_notes;notesLabel.append(notes);const save=node('button','Save inquiry status','button');form.append(statusLabel,notesLabel,save);
  form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await api(`/api/admin/inquiries/${id}`,{method:'PATCH',body:{status:select.value,adminNotes:notes.value,version:d.version}});await openInquiry(id);await loadInquiries(inquiryPage);notice('Inquiry status and history saved.');}catch(error){notice(error.message);}finally{save.disabled=false;}});section.append(form,node('h3','Status history'));
  for(const event of d.events)section.append(node('p',`${event.created_at} UTC · ${event.actor} · ${event.status}\n${event.notes}`,'management-event'));
  section.focus();
}
async function enter(session){
  csrf=session.csrf;q('#management-login').hidden=true;q('#management-workspace').hidden=false;q('#logout').hidden=false;
  await loadCategories();await Promise.all([loadProducts(),loadInquiries()]);
  const d=await api('/api/admin/system');q('#system-status').textContent=`Database connected. SMTP ${d.smtpConfigured?'configured; check notification status for actual sending':'not configured; inquiries remain saved and notifications remain queued'}.`;
  notice(`Signed in as ${session.email}.`);
}
q('#management-login').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;notice('Signing in…');try{const d=await api('/api/auth/login',{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget))});e.target.reset();await enter(d);}catch(error){notice(error.message);}finally{b.disabled=false;}});
q('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:{}});loggedOut();notice('Signed out.');}catch(error){notice(error.message);}});
document.querySelectorAll('[data-panel]').forEach(b=>b.addEventListener('click',()=>{for(const other of document.querySelectorAll('[data-panel]')){const active=other===b;other.setAttribute('aria-pressed',String(active));q('#panel-'+other.dataset.panel).hidden=!active;}}));
q('#new-product').addEventListener('click',()=>{editProduct();if(!categories.length)notice('Add a category in Categories before saving a product.');});q('#cancel-product').addEventListener('click',()=>{q('#product-editor').hidden=true;editing=null;});
q('#product-editor').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,b=form.querySelector('button');b.disabled=true;try{const d=Object.fromEntries(new FormData(form));d.active=form.elements.active.checked;if(editing)d.version=editing.version;await api(editing?`/api/admin/products/${editing.id}`:'/api/admin/products',{method:editing?'PUT':'POST',body:d});form.hidden=true;editing=null;await loadProducts(productPage);notice('Product saved to the database.');}catch(error){notice(error.message);}finally{b.disabled=false;}});
q('#category-create').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{await api('/api/admin/categories',{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget))});e.target.reset();await loadCategories();notice('Category created.');}catch(error){notice(error.message);}finally{b.disabled=false;}});
for(const [form,load]of [['#product-search',loadProducts],['#inquiry-search',loadInquiries]])q(form).addEventListener('submit',async e=>{e.preventDefault();try{await load();}catch(error){notice(error.message);}});
try{await enter(await api('/api/admin/session'));}catch(error){loggedOut();if(!error.message.includes('sign in'))notice(error.message);}
