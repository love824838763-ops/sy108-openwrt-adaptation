/* --- SY108 overlay: back-link to the status page on the upstream signal dashboard --- */
(function(){
  function add(){
    if(document.querySelector('.sy108-back')) return;
    var a=document.createElement('a');
    a.className='sy108-back';
    a.href='/';
    a.title='返回免登录状态页';
    a.textContent='← 设备状态';
    document.body.appendChild(a);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',add);
  else add();
})();
