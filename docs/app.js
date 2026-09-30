(() => {
  'use strict';
  const API='https://api.data.gov.my/data-catalogue?id=fuelprice&filter=level@series_type&limit=10000';
  const FUELS=[
    {key:'ron95',label:'RON95',color:'#4677c6'},
    {key:'ron95_budi95',label:'RON95 BUDI95',color:'#858e17'},
    {key:'ron97',label:'RON97',color:'#9a6acc'},
    {key:'diesel',label:'Diesel · Peninsular',color:'#be7430'},
    {key:'diesel_eastmsia',label:'Diesel · East Malaysia',color:'#238f99'},
    {key:'ron95_skps',label:'RON95 SKPS',color:'#bf698c'},
    {key:'diesel_budi',label:'Diesel BUDI',color:'#3a9471'},
    {key:'diesel_skds',label:'Diesel SKDS',color:'#62708f'}
  ];
  const $=id=>document.getElementById(id);
  let rows=[],page=0,period='12',selected=['ron95','ron95_budi95','ron97','diesel'];
  const pageSize=15,charts={};
  const asDate=x=>new Date(`${x}T00:00:00Z`);
  const formatDate=x=>asDate(x).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
  const money=x=>x==null?'—':Number(x).toFixed(2);
  const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validate(input){
    if(!Array.isArray(input)||input.length<20||input.length>=10000)throw new Error('Incomplete source response');
    const seen=new Set();
    const clean=input.map(r=>{
      if(!r||r.series_type!=='level'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(asDate(r.date).getTime())||asDate(r.date).toISOString().slice(0,10)!==r.date||seen.has(r.date))throw new Error('Invalid or duplicate effective date');
      seen.add(r.date);const item={date:r.date,series_type:'level'};
      FUELS.forEach(f=>{const value=r[f.key];if(value==null){item[f.key]=null;return;}if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new Error('Invalid price');item[f.key]=value;});
      if(!FUELS.some(f=>item[f.key]!=null))throw new Error('No observed price');
      return item;
    }).sort((a,b)=>a.date.localeCompare(b.date));
    return clean;
  }
  function bounds(){
    const first=rows[0].date,last=rows.at(-1).date;
    ['start-date','end-date'].forEach(id=>{const e=$(id);e.min=first;e.max=last;});
    $('coverage').textContent=`Source coverage: ${formatDate(first)} – ${formatDate(last)} · ${rows.length} dates`;
  }
  function applyPeriod(p){
    period=p;const last=rows.at(-1).date;let start=rows[0].date;
    if(p!=='all'){const d=asDate(last);d.setUTCMonth(d.getUTCMonth()-Number(p));start=d.toISOString().slice(0,10);if(start<rows[0].date)start=rows[0].date;}
    $('start-date').value=start;$('end-date').value=last;
    document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===p)));
    page=0;render();
  }
  function filtered(){
    const start=$('start-date').value,end=$('end-date').value;
    if(!start||!end||start>end)return [];
    return rows.filter(r=>r.date>=start&&r.date<=end);
  }
  function latest(f,data){return data.filter(r=>r[f.key]!=null).at(-1)||null;}
  function previous(f,record){return rows.filter(r=>r.date<record.date&&r[f.key]!=null).at(-1)||null;}
  function optionBase(){return {animation:!matchMedia('(prefers-reduced-motion: reduce)').matches,textStyle:{fontFamily:'Arial,Helvetica,sans-serif',fontSize:12,color:'#536b83'},aria:{enabled:true},tooltip:{trigger:'axis',confine:true,backgroundColor:'#101c2e',borderWidth:0,textStyle:{color:'#fff',fontSize:13},valueFormatter:v=>v==null?'No observation':`RM ${Number(v).toFixed(2)} / L`},grid:{left:53,right:25,top:49,bottom:59},legend:{type:'scroll',top:13,left:21,right:21,textStyle:{fontSize:12,color:'#536b83'},icon:'roundRect'},xAxis:{type:'category',axisLine:{lineStyle:{color:'#c9d4e1'}},axisTick:{show:false},axisLabel:{hideOverlap:true,color:'#637b93',formatter:x=>x.length===7?x:asDate(x).toLocaleDateString('en-MY',{month:'short',year:'2-digit',timeZone:'UTC'})}},yAxis:{type:'value',min:0,axisLabel:{formatter:v=>Number(v).toFixed(1),color:'#637b93'},splitLine:{lineStyle:{color:'#e7edf5'}}}};}
  function emptyChart(name,message){charts[name].clear();charts[name].setOption({graphic:{type:'text',left:'center',top:'middle',style:{text:message,fill:'#6a8096',font:'14px Arial',textAlign:'center'}}});}
  function drawTrend(data,fuels){
    if(!data.length||!fuels.length)return emptyChart('trend-chart','Choose fuel categories and a period with observations.');
    const opt=optionBase();opt.grid.bottom=78;opt.xAxis.data=data.map(r=>r.date);
    opt.dataZoom=[{type:'inside',filterMode:'none'},{type:'slider',bottom:12,height:20,showDetail:false,borderColor:'#d7e0eb',fillerColor:'rgba(71,119,198,.12)',dataBackground:{lineStyle:{color:'#bccadd'},areaStyle:{color:'#ecf1f7'}}}];
    opt.series=fuels.map(f=>({name:f.label,type:'line',data:data.map(r=>r[f.key]),showSymbol:false,connectNulls:false,step:'end',lineStyle:{width:2.3,color:f.color},itemStyle:{color:f.color},emphasis:{focus:'series'}}));
    charts['trend-chart'].setOption(opt,true);
  }
  function drawComparison(data,fuels){
    const observed=fuels.map(f=>({f,r:latest(f,data)})).filter(x=>x.r).sort((a,b)=>a.r[a.f.key]-b.r[b.f.key]);
    if(!observed.length)return emptyChart('comparison-chart','No selected prices in this period.');
    const opt=optionBase();delete opt.legend;opt.grid={left:135,right:62,top:26,bottom:37};
    opt.xAxis={type:'value',min:0,splitLine:{lineStyle:{color:'#e7edf5'}},axisLabel:{formatter:v=>Number(v).toFixed(1)}};
    opt.yAxis={type:'category',data:observed.map(x=>x.f.label),axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:12,color:'#536b83',width:119,overflow:'truncate'},splitLine:{show:false}};
    opt.tooltip={trigger:'item',confine:true,formatter:p=>`${escape(observed[p.dataIndex].f.label)}<br>RM ${p.value.toFixed(2)} / L<br>${formatDate(observed[p.dataIndex].r.date)}`};
    opt.series=[{type:'bar',barMaxWidth:24,data:observed.map(x=>({value:x.r[x.f.key],itemStyle:{color:x.f.color,borderRadius:[0,4,4,0]}})),label:{show:true,position:'right',formatter:p=>`RM ${p.value.toFixed(2)}`,fontSize:12,color:'#435b76'}}];
    charts['comparison-chart'].setOption(opt,true);
  }
  function monthly(data,fuels){
    const groups=new Map();data.forEach(r=>{const k=r.date.slice(0,7);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);});
    const keys=[...groups.keys()];return {keys,series:fuels.map(f=>({f,values:keys.map(k=>{const values=groups.get(k).map(r=>r[f.key]).filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;})}))};
  }
  function drawMonthly(data,fuels){
    if(!data.length||!fuels.length)return emptyChart('monthly-chart','No selected observations to average.');
    const m=monthly(data,fuels),opt=optionBase();opt.xAxis.data=m.keys;opt.grid.bottom=41;
    opt.series=m.series.map(x=>({name:x.f.label,type:'line',data:x.values,showSymbol:true,symbolSize:5,connectNulls:false,lineStyle:{width:2,color:x.f.color},itemStyle:{color:x.f.color}}));
    charts['monthly-chart'].setOption(opt,true);
  }
  function drawGap(data){
    const valid=data.filter(r=>r.diesel!=null&&r.diesel_eastmsia!=null);const last=valid.at(-1);
    $('gap-value').textContent=last?`RM ${(last.diesel-last.diesel_eastmsia).toFixed(2)}`:'—';
    $('gap-date').textContent=last?`${formatDate(last.date)} · per litre`:'No paired observations';
    if(!valid.length)return emptyChart('gap-chart','No date has both regional diesel prices in this period.');
    const opt=optionBase();delete opt.legend;opt.grid={left:53,right:25,top:22,bottom:41};opt.xAxis.data=data.map(r=>r.date);delete opt.yAxis.min;
    opt.series=[{name:'Peninsular minus East Malaysia',type:'line',data:data.map(r=>r.diesel!=null&&r.diesel_eastmsia!=null?Number((r.diesel-r.diesel_eastmsia).toFixed(4)):null),showSymbol:false,connectNulls:false,step:'end',lineStyle:{color:'#238f99',width:2.3},itemStyle:{color:'#238f99'},areaStyle:{color:'rgba(35,143,153,.10)'}}];
    charts['gap-chart'].setOption(opt,true);
  }
  function renderCards(data,fuels){
    if(!fuels.length){$('price-cards').innerHTML='<div class="empty-card">Select at least one fuel category to compare prices.</div>';return;}
    $('price-cards').innerHTML=fuels.map(f=>{
      const r=latest(f,data);if(!r)return `<article class="price-card" style="--fuel-color:${f.color}"><h3 class="price-label">${f.label}</h3><p class="price-empty">No observation in this range</p></article>`;
      const prev=previous(f,r),delta=prev?r[f.key]-prev[f.key]:null;
      const change=delta==null?'No prior observation':`${delta>0?'+':''}${delta.toFixed(2)} RM/L`;
      return `<article class="price-card" style="--fuel-color:${f.color}"><h3 class="price-label">${f.label}</h3><p class="price-value"><small>RM</small>${money(r[f.key])}<small>/ L</small></p><div class="price-meta"><span>${formatDate(r.date)}</span><span class="movement ${delta>0?'up':delta<0?'down':''}">${change}</span></div></article>`;
    }).join('');
  }
  function renderTable(data,fuels){
    const sorted=[...data].reverse(),total=sorted.length,pages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,pages-1);
    const table=$('data-table');table.querySelector('thead').innerHTML=`<tr><th scope="col">Effective date</th>${fuels.map(f=>`<th scope="col">${f.label} (RM/L)</th>`).join('')}</tr>`;
    table.querySelector('tbody').innerHTML=total?sorted.slice(page*pageSize,(page+1)*pageSize).map(r=>`<tr><th scope="row">${formatDate(r.date)}</th>${fuels.map(f=>`<td>${money(r[f.key])}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${fuels.length+1}">No observations in this range.</td></tr>`;
    $('page-status').textContent=total?`${page*pageSize+1}–${Math.min(total,(page+1)*pageSize)} of ${total} dates`:'0 dates';
    $('table-subtitle').textContent=`${fuels.length} categories · ${total} effective dates · missing values shown as —`;
    $('previous-page').disabled=page===0;$('next-page').disabled=page>=pages-1;$('download').disabled=!total||!fuels.length;
  }
  function render(){
    const data=filtered(),fuels=FUELS.filter(f=>selected.includes(f.key));
    $('filter-message').textContent=$('start-date').value>$('end-date').value?'The start date must be on or before the end date.':!fuels.length?'Select at least one fuel category.':!data.length?'There are no published observations in this date range.':'';
    renderCards(data,fuels);renderTable(data,fuels);
    if(Object.keys(charts).length){drawTrend(data,fuels);drawComparison(data,fuels);drawMonthly(data,fuels);drawGap(data);}
  }
  function setStatus(message,warning=false){$('load-status').textContent=message;$('load-status').classList.toggle('warning',warning);}
  async function refresh(){
    const button=$('refresh');if(button.disabled)return;button.disabled=true;button.textContent='Refreshing…';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(API,{signal:controller.signal,mode:'cors'});if(!response.ok)throw new Error('API unavailable');
      const fresh=validate(await response.json());const priorLatest=rows.at(-1)?.date;
      if(priorLatest&&fresh.at(-1).date<priorLatest)throw new Error('Older response than saved data');
      rows=fresh;bounds();if(period)applyPeriod(period);else render();
      const last=rows.at(-1).date,age=(Date.now()-asDate(last).getTime())/86400000;
      setStatus(`Official API verified · latest effective date ${formatDate(last)} · ${rows.length} observations${age>35?' · source is over 35 days old':''}`,age>35);
    }catch{
      const last=rows.at(-1)?.date;
      setStatus(last?`Refresh unavailable · using saved official data through ${formatDate(last)}`:'Official data is unavailable. Please try Refresh again.',true);
    }finally{clearTimeout(timeout);button.disabled=false;button.textContent='Refresh official data';}
  }
  function download(){
    const data=[...filtered()].reverse(),fuels=FUELS.filter(f=>selected.includes(f.key));
    const csv=[['effective_date',...fuels.map(f=>`${f.key}_rm_per_litre`)].join(','),...data.map(r=>[r.date,...fuels.map(f=>r[f.key]==null?'':r[f.key].toFixed(2))].join(','))].join('\r\n');
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`malaysia-fuel-prices_${$('start-date').value}_${$('end-date').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('fuel-options').innerHTML=FUELS.map(f=>`<label class="fuel-option" style="--fuel-color:${f.color}"><input type="checkbox" value="${f.key}" ${selected.includes(f.key)?'checked':''}><span class="fuel-swatch" aria-hidden="true"></span>${f.label}</label>`).join('');
  $('fuel-options').addEventListener('change',()=>{selected=[...$('fuel-options').querySelectorAll('input:checked')].map(e=>e.value);page=0;render();});
  ['start-date','end-date'].forEach(id=>$(id).addEventListener('change',()=>{period=null;document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed','false'));page=0;render();}));
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>applyPeriod(b.dataset.period)));
  $('reset').addEventListener('click',()=>{selected=['ron95','ron95_budi95','ron97','diesel'];$('fuel-options').querySelectorAll('input').forEach(e=>{e.checked=selected.includes(e.value);});applyPeriod('12');});
  $('previous-page').addEventListener('click',()=>{page--;renderTable(filtered(),FUELS.filter(f=>selected.includes(f.key)));});
  $('next-page').addEventListener('click',()=>{page++;renderTable(filtered(),FUELS.filter(f=>selected.includes(f.key)));});
  $('download').addEventListener('click',download);$('refresh').addEventListener('click',refresh);
  try{rows=validate(window.FUEL_SNAPSHOT.rows);bounds();applyPeriod('12');setStatus(`Saved official data through ${formatDate(rows.at(-1).date)} · checking for updates…`);}catch{setStatus('Saved dataset could not be read. Use Refresh official data.',true);}
  if(window.echarts){['trend-chart','comparison-chart','monthly-chart','gap-chart'].forEach(id=>{charts[id]=echarts.init($(id),null,{renderer:'svg'});});render();const observer=new ResizeObserver(()=>Object.values(charts).forEach(chart=>chart.resize()));Object.keys(charts).forEach(id=>observer.observe($(id)));}else{document.querySelectorAll('.chart').forEach(e=>{e.classList.add('chart-error');e.textContent='Charts could not load. The prices and source table remain available.';});}
  refresh();
})();
