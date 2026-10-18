const q = s => document.querySelector(s);
function el(tag, text, cls) { const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node; }
let sequence=0;
async function load(page=1) {
  const current=++sequence, status=q('#catalog-status');status.textContent='Loading products…';
  try {
    const params=new URLSearchParams({q:q('#parts-query').value,category:q('#catalog-category').value,vehicleType:q('#catalog-vehicle').value,page:String(page)});
    const response=await fetch(`/api/products?${params}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Product search is unavailable. You can still describe your parts in the purchasing brief.');
    const data=await response.json();if(current!==sequence)return;
    q('#product-results').replaceChildren();q('#product-pagination').replaceChildren();
    for(const p of data.products){
      const article=el('article','','procurement-product');
      if(p.imageUrl){const img=el('img');img.src=p.imageUrl;img.alt=p.name;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove(),{once:true});article.append(img);}
      article.append(el('p',`${p.category} · ${p.sku}`,'product-reference'),el('h3',p.name),el('p',p.description),el('p',p.specifications));
      article.append(el('p','Availability, fitment and price confirmed by quotation.','product-reference'));
      const add=el('button','Add to procurement list','button');add.type='button';add.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('pb-add-catalog-product',{detail:p})));article.append(add);q('#product-results').append(article);
    }
    status.textContent=data.total?`${data.total} product(s). Add several products to one purchasing brief.`:'No matching products are published. Tell us what you need below.';
    const pagination=(label,target)=>{const b=el('button',label,'button button-outline');b.type='button';b.addEventListener('click',()=>load(target));q('#product-pagination').append(b);};
    if(page>1)pagination('Previous',page-1);if(page*24<data.total)pagination('Next',page+1);
  }catch(error){if(current===sequence)status.textContent=error.message;}
}
q('#parts-search-form').addEventListener('submit',e=>{e.preventDefault();load();location.hash='find-parts';});
for(const id of ['#catalog-category','#catalog-vehicle'])q(id).addEventListener('change',()=>load());
try { const response=await fetch('/api/categories');if(!response.ok)throw new Error();const data=await response.json();for(const c of data.categories)q('#catalog-category').append(new Option(c.name,c.id)); }
catch{q('#catalog-status').textContent='Categories are unavailable. Describe your parts below.';}
await load();
