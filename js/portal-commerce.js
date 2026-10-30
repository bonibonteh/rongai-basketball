// Rongai Ballers and Street Culture management. All writes are permission-gated by Supabase RLS.
(function () {
  'use strict';
  const RB=window.RBT, sb=RB.sb, P=RB.P;
  const {$,$$,esc,can,q,toast,card,empty,btn,chip,icons}=P;
  const guard=fn=>async(...a)=>{try{return await fn(...a)}catch(e){P.fail(e)}};
  const storageUrl=(bucket,path)=>path?sb.storage.from(bucket).getPublicUrl(path).data.publicUrl:'';
  const money=n=>'KES '+Number(n||0).toLocaleString('en-KE');
  const split=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
  function editor(title,fields,initial={}) {
    return new Promise(resolve=>{
      const w=document.createElement('div'); w.className='fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 p-4';
      w.innerHTML='<form class="bg-rbtCard border border-rbtBorder rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-3"><h3 class="font-heading font-bold text-lg text-white">'+esc(title)+'</h3>'+
        fields.map(f=>'<label class="block text-xs font-bold uppercase text-gray-300">'+esc(f.label)+(f.type==='textarea'?'<textarea name="'+f.name+'" rows="3" class="mt-1 w-full bg-black/50 border border-rbtBorder rounded-lg p-2.5 text-sm text-white normal-case font-normal">'+esc(initial[f.name]??f.value??'')+'</textarea>':'<input name="'+f.name+'" type="'+(f.type||'text')+'" value="'+esc(initial[f.name]??f.value??'')+'" '+(f.required?'required':'')+' class="mt-1 w-full bg-black/50 border border-rbtBorder rounded-lg p-2.5 text-sm text-white normal-case font-normal">')+'</label>').join('')+
        '<p class="hidden text-xs text-red-300" data-err></p><div class="flex justify-end gap-2"><button type="button" data-cancel class="px-4 py-2 rounded-lg border border-rbtBorder text-xs text-gray-300">Cancel</button><button class="px-4 py-2 rounded-lg bg-rbtOrange text-black text-xs font-bold uppercase">Save</button></div></form>';
      document.body.appendChild(w); const f=$('form',w);
      $('[data-cancel]',w).onclick=()=>{w.remove();resolve(null)};
      f.onsubmit=e=>{e.preventDefault();const out={};fields.forEach(x=>out[x.name]=f.elements[x.name].value.trim());w.remove();resolve(out)};
    });
  }
  async function merchRender(main){
    if(!can('merch.manage')) return main.innerHTML=empty('You do not have permission to manage merchandise.');
    const rows=await q(sb.from('merch_products').select('*').order('display_order').order('created_at',{ascending:false}));
    main.innerHTML='<div class="max-w-6xl mx-auto space-y-4">'+card('Street Culture Official Merch', '<div class="flex justify-between items-center gap-3 mb-3"><p class="text-xs text-gray-400">Manage products, prices, stock and public visibility.</p>'+btn('Add product','id="mc-add"','primary')+'</div>'+
      (rows.length?'<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">'+rows.map(p=>'<article class="bg-black/30 border border-rbtBorder rounded-xl overflow-hidden">'+(p.image_paths?.[0]?'<img src="'+esc(storageUrl('merch-images',p.image_paths[0]))+'" class="w-full h-44 object-cover" alt="">':'<div class="h-44 flex items-center justify-center text-rbtOrange font-heading font-bold">STREET CULTURE</div>')+'<div class="p-4 space-y-2"><div class="flex justify-between gap-2"><b class="text-white">'+esc(p.name)+'</b>'+chip(p.status)+'</div><p class="text-xs text-gray-400">'+esc(p.description||'')+'</p><div class="flex justify-between text-sm"><b class="text-rbtGold">'+money(p.price_kes)+'</b><span class="text-gray-400">Stock: '+p.stock+'</span></div><p class="text-[11px] text-gray-500">'+esc(p.category)+' · '+esc(p.availability)+'</p><div class="flex gap-2">'+btn('Edit','data-me="'+p.id+'"','primary')+btn('Publish / unpublish','data-mp="'+p.id+'"')+btn('Archive','data-ma="'+p.id+'","danger"')+'</div></div></article>').join('')+'</div>':empty('No merchandise products yet.'))+'</div>');
    const save=async(id)=>{const p=rows.find(x=>x.id===id)||{},v=await editor(id?'Edit product':'Add merchandise product',[
      {name:'name',label:'Product name',required:true},{name:'description',label:'Description',type:'textarea'},
      {name:'category',label:'Category',value:'Apparel'},{name:'price_kes',label:'Price (KES)',type:'number',value:'0'},
      {name:'sizes',label:'Sizes (comma separated)'},{name:'colours',label:'Colours (comma separated)'},
      {name:'stock',label:'Stock quantity',type:'number',value:'0'},{name:'availability',label:'Availability: available / sold_out / coming_soon',value:'available'},
      {name:'image_url',label:'Product image URL (optional)'},{name:'status',label:'Status: draft / published / archived',value:'draft'},
      {name:'display_order',label:'Display order',type:'number',value:'0'}
    ],{...p,sizes:(p.sizes||[]).join(', '),colours:(p.colours||[]).join(', '),image_url:p.image_paths?.[0]&&storageUrl('merch-images',p.image_paths[0])});
      if(!v)return;
      const imagePath=v.image_url&&/^https:\/\//.test(v.image_url)?[v.image_url]:[];
      const patch={name:v.name,description:v.description,category:v.category||'General',price_kes:Number(v.price_kes||0),sizes:split(v.sizes),colours:split(v.colours),stock:Math.max(0,Number(v.stock||0)),availability:v.availability||'available',image_paths:imagePath,is_featured:p.is_featured||false,status:v.status||'draft',display_order:Number(v.display_order||0)};
      const res=id?await sb.from('merch_products').update(patch).eq('id',id):await sb.from('merch_products').insert(patch);
      if(res.error)throw res.error;toast('Merchandise saved.');merchRender(main);
    };
    $('#mc-add',main).onclick=guard(()=>save(null));
    $$('[data-me]',main).forEach(b=>b.onclick=guard(()=>save(b.dataset.me)));
    $$('[data-mp]',main).forEach(b=>b.onclick=guard(async()=>{const p=rows.find(x=>x.id===b.dataset.mp);const {error}=await sb.from('merch_products').update({status:p.status==='published'?'draft':'published'}).eq('id',p.id);if(error)throw error;toast('Product visibility updated.');merchRender(main)}));
    $$('[data-ma]',main).forEach(b=>b.onclick=guard(async()=>{const {error}=await sb.from('merch_products').update({status:'archived'}).eq('id',b.dataset.ma);if(error)throw error;toast('Product archived.');merchRender(main)}));
  }
  async function ballersRender(main){
    if(!can('roster.manage')&&!can('teams.review')) return main.innerHTML=empty('You do not have permission to manage the Rongai Ballers roster.');
    const [players,teams,cards]=await Promise.all([
      q(sb.from('players').select('*').order('full_name')),
      q(sb.from('teams').select('id,name').order('name')),
      q(sb.from('baller_trading_cards').select('*').order('created_at',{ascending:false}))
    ]);
    main.innerHTML='<div class="max-w-6xl mx-auto space-y-5">'+card('Rongai Ballers — Player roster','<div class="flex justify-between items-center gap-3 mb-3"><p class="text-xs text-gray-400">Manage player profiles and roster status.</p>'+btn('Add player','id="bp-add"','primary')+'</div>'+
      (players.length?'<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">'+players.map(p=>'<article class="bg-black/30 border border-rbtBorder rounded-xl p-4 flex gap-3">'+(p.photo_path?'<img src="'+esc(storageUrl('player-photos',p.photo_path))+'" class="w-16 h-16 rounded-lg object-cover" alt="">':'<div class="w-16 h-16 rounded-lg bg-rbtBorder flex items-center justify-center text-rbtOrange font-bold">'+esc(P.initials(p.full_name))+'</div>')+'<div class="min-w-0 flex-1"><b class="text-white">'+esc(p.full_name)+'</b><p class="text-xs text-gray-400">'+esc(teams.find(t=>t.id===p.team_id)?.name||'No team')+' · '+esc(p.position||'Position not set')+' · #'+esc(p.jersey_no??'—')+'</p><p class="text-xs mt-1">'+chip(p.status)+'</p><div class="flex gap-2 mt-2">'+btn('Edit','data-pe="'+p.id+'"')+btn('Create card','data-pc="'+p.id+'"','primary')+'</div></div></article>').join('')+'</div>':empty('No player profiles yet. Add verified player details to build the roster.')))+
      card('Trading card collection','<div class="flex items-center justify-between mb-3"><p class="text-xs text-gray-400">Create, publish and archive collectible player cards.</p></div>'+
      (cards.length?'<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">'+cards.map(c=>'<div class="bg-black/30 border border-rbtBorder rounded-xl p-4"><p class="text-white font-bold">'+esc(players.find(p=>p.id===c.player_id)?.full_name||'Player')+'</p><p class="text-xs text-rbtGold">'+esc(c.edition)+' · '+esc(c.rarity)+' · '+esc(c.season)+'</p><p class="text-xs text-gray-400 mt-1">'+esc(c.collection_name)+' · '+chip(c.status)+'</p><div class="flex gap-2 mt-3">'+btn('Edit card','data-ce="'+c.id+'"')+btn('Toggle publish','data-cp="'+c.id+'","primary"')+'</div></div>').join('')+'</div>':empty('No trading cards created yet.'))+'</div>');
    const playerForm=async(id)=>{const p=players.find(x=>x.id===id)||{};const v=await editor(id?'Edit player':'Add player',[
      {name:'full_name',label:'Full name',required:true},{name:'team_id',label:'Team ID (select from team list)',value:p.team_id||teams[0]?.id||''},
      {name:'jersey_no',label:'Jersey number',type:'number'},{name:'position',label:'Position'},{name:'height_cm',label:'Height (cm)',type:'number'},
      {name:'nationality',label:'Nationality'},{name:'bio',label:'Player biography',type:'textarea'},
      {name:'status',label:'Status: active / injured / unavailable / suspended / archived',value:p.status||'active'}
    ],p);if(!v)return;
      const patch={full_name:v.full_name,team_id:v.team_id,jersey_no:v.jersey_no===''?null:Number(v.jersey_no),position:v.position||null,height_cm:v.height_cm===''?null:Number(v.height_cm),nationality:v.nationality||null,bio:v.bio||null,status:v.status||'active',is_published:true};
      const r=id?await sb.from('players').update(patch).eq('id',id):await sb.from('players').insert(patch);if(r.error)throw r.error;toast('Player saved.');ballersRender(main);
    };
    $('#bp-add',main).onclick=guard(()=>playerForm(null));
    $$('[data-pe]',main).forEach(b=>b.onclick=guard(()=>playerForm(b.dataset.pe)));
    const cardForm=async(id,pid)=>{const c=cards.find(x=>x.id===id)||{};const v=await editor(id?'Edit trading card':'Create trading card',[
      {name:'player_id',label:'Player ID',value:pid||c.player_id,required:true},{name:'season',label:'Season',value:c.season||'2026'},
      {name:'edition',label:'Edition: Standard / Silver / Gold / Elite / Limited',value:c.edition||'Standard'},
      {name:'rarity',label:'Rarity: Common / Uncommon / Rare / Epic / Legendary',value:c.rarity||'Common'},
      {name:'collection_name',label:'Collection name',value:c.collection_name||'Rongai Ballers'},
      {name:'stats',label:'Verified stats JSON (optional)',type:'textarea',value:JSON.stringify(c.stats||{},null,2)},
      {name:'status',label:'Status: draft / published / archived',value:c.status||'draft'}
    ],c);if(!v)return;let stats={};try{stats=JSON.parse(v.stats||'{}');if(!stats||Array.isArray(stats)||typeof stats!=='object')throw 0}catch(e){throw new Error('Stats must be a valid JSON object.');}
      const patch={player_id:v.player_id,season:v.season,edition:v.edition,rarity:v.rarity,collection_name:v.collection_name,stats,status:v.status};
      const r=id?await sb.from('baller_trading_cards').update(patch).eq('id',id):await sb.from('baller_trading_cards').insert(patch);if(r.error)throw r.error;toast('Trading card saved.');ballersRender(main);
    };
    $$('[data-pc]',main).forEach(b=>b.onclick=guard(()=>cardForm(null,b.dataset.pc)));
    $$('[data-ce]',main).forEach(b=>b.onclick=guard(()=>cardForm(b.dataset.ce,null)));
    $$('[data-cp]',main).forEach(b=>b.onclick=guard(async()=>{const c=cards.find(x=>x.id===b.dataset.cp);const {error}=await sb.from('baller_trading_cards').update({status:c.status==='published'?'draft':'published'}).eq('id',c.id);if(error)throw error;toast('Trading card visibility updated.');ballersRender(main)}));
  }
  P.modules.merch={render:merchRender,watch:[]};
  P.modules.ballers={render:ballersRender,watch:[]};
})();