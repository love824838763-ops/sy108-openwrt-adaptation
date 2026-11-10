/* =============================================================
 * udx-signal-polish.js — 上游 UDX710 信号看板一致化外挂
 *
 * 1) 右下角「← 设备状态」返回入口（回到免登录状态页）
 * 2) 中英切换：DOM 文本节点翻译 + MutationObserver 覆盖动态渲染
 *    - 不修改上游 signal.html 一行逻辑，只挂外链
 *    - 语言与状态页共用 cookie（sy108-lang），跨页面一致
 *
 * 注意：上游每 10 秒重绘 innerHTML，因此必须监听 DOM 变化。
 * 替换文本会再次触发 mutation，故处理前后 disconnect / reobserve。
 * ============================================================= */
(function () {
  'use strict';

  /* ---------------- 语言 ---------------- */
  function ck(n) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)'));
    return m ? m[1] : '';
  }
  function setck(n, v) {
    try { document.cookie = n + '=' + v + ';path=/;max-age=31536000;SameSite=Lax'; } catch (e) {}
  }
  var LANG = ck('sy108-lang');
  if (LANG !== 'zh' && LANG !== 'en') {
    LANG = (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  }

  /* 中文 → 英文。长句在前由代码按长度排序，避免短词先破坏整句。 */
  var MAP = {
    'UDX710 · 信号看板': 'UDX710 · Signal dashboard',
    'UDX710 · 实时蜂窝状态': 'UDX710 · Live cellular status',
    '数据来源 · ubus ': 'Source: ubus ',
    ' · 每 10 秒刷新': ' · refreshes every 10 s',
    '信号看板': 'Signal dashboard',
    '连接中…': 'Connecting…',
    '刷新': 'Refresh',
    '自动刷新：关': 'Auto refresh: OFF',
    '自动刷新：开': 'Auto refresh: ON',
    'ubus 调用失败': 'ubus call failed',
    'ubus 返回 rc=': 'ubus returned rc=',
    '中国移动': 'China Mobile', '中国联通': 'China Unicom',
    '中国电信': 'China Telecom', '中国广电': 'China Broadnet',
    '自定义': 'Custom',
    '已注册（漫游）': 'Registered (roaming)',
    '注册被拒': 'Registration denied',
    '搜网中': 'Searching',
    '已注册': 'Registered',
    '未注册': 'Not registered',
    '未知': 'Unknown',
    '服务小区与邻区': 'Serving cell & neighbours',
    '暂无小区信息。设备注册到网络后这里会列出服务小区与邻区。': 'No cell information yet. Serving cell and neighbours appear once the device registers.',
    '类型': 'Type', '制式': 'Mode', '频段': 'Band',
    '服务小区': 'Serving', '邻区': 'Neighbour',
    '尚未检测到 SIM 卡': 'No SIM card detected',
    '模块已上电，但 SIM 卡槽为空或未被识别，因此没有运营商、信号强度和小区信息。': 'The modem is powered but the SIM slot is empty or not detected, so carrier, signal strength and cell data are unavailable.',
    '模块回应：': 'Modem reply: ',
    '插入 SIM 卡并启用后，本页会自动出现运营商、RSRP/SINR 与小区列表。数据每 10 秒自动刷新一次。': 'After inserting and enabling a SIM, carrier, RSRP/SINR and the cell list appear automatically. Data refreshes every 10 seconds.',
    '网络概览': 'Network overview',
    '运营商': 'Carrier', '注册状态': 'Registration',
    '漫游': 'Roaming',
    '信号质量': 'Signal quality', '信号强度': 'Signal strength',
    '信号数值将在模块注册到网络并上报测量值后出现。': 'Signal values appear once the modem registers and reports measurements.',
    'RSRP 参考：优秀 ≥ -80 dBm，良好 ≥ -90 dBm，一般 ≥ -100 dBm，差 &lt; -110 dBm。': 'RSRP reference: excellent ≥ -80 dBm, good ≥ -90 dBm, fair ≥ -100 dBm, poor < -110 dBm.',
    '未注册到网络': 'Not registered to network',
    'SIM 已识别，但网络注册未成功。可检查 SIM 状态、是否欠费、信号覆盖与漫游设置。': 'The SIM is detected but network registration failed. Check SIM status, account balance, coverage and roaming settings.',
    '正在搜索网络': 'Searching for a network',
    '模块已上电，正在尝试注册驻网网络。': 'The modem is powered and trying to register on a network.',
    '数据陈旧（': 'Stale data (',
    ' 前）': ' ago)',
    '数据可能已过期': 'Data may be out of date',
    '模块响应较慢，显示的是 ': 'The modem responded slowly; showing a snapshot from ',
    ' 秒前的快照。': ' seconds ago.',
    '若干': 'several',
    '实时': 'Live', '读取失败': 'Read failed',
    '无法读取蜂窝状态': 'Could not read cellular status',
    '是': 'Yes', '否': 'No'
  };
  var KEYS = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; });
  /* 仅允许这些短词参与「子串」替换，其余短词只在整段完全相等时替换，避免误伤 */
  var SHORT_OK = { '是': 1, '否': 1, '刷新': 1, '实时': 1, '漫游': 1, '运营商': 1, '制式': 1, '频段': 1, '类型': 1 };

  var originals = null;
  try { originals = new WeakMap(); } catch (e) { originals = null; }

  function translate(s) {
    var trimmed = s.trim();
    if (Object.prototype.hasOwnProperty.call(MAP, trimmed)) {
      return s.replace(trimmed, MAP[trimmed]);
    }
    var out = s;
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (k.length < 4 && !SHORT_OK[k]) continue;
      if (out.indexOf(k) >= 0) out = out.split(k).join(MAP[k]);
    }
    return out;
  }

  function isOwnUI(node) {
    var p = node.parentNode;
    while (p && p !== document.body) {
      if (p.getAttribute && p.getAttribute('data-sy108-skip')) return true;
      p = p.parentNode;
    }
    return false;
  }

  function walk(root, toEn) {
    var tw = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (isOwnUI(n)) return NodeFilter.FILTER_REJECT;
        if (n.parentNode && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentNode.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = tw.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (toEn) {
        var cur = node.nodeValue;
        if (originals) {
          if (!originals.has(node)) originals.set(node, cur);
          else cur = originals.get(node);
        }
        var nxt = translate(cur);
        if (nxt !== node.nodeValue) node.nodeValue = nxt;
      } else if (originals && originals.has(node)) {
        node.nodeValue = originals.get(node);
      }
    }
  }

  /* ---------------- 悬浮控件（返回入口 + 语言按钮） ---------------- */
  function addUI() {
    if (!document.querySelector('.sy108-back')) {
      var a = document.createElement('a');
      a.className = 'sy108-back';
      a.setAttribute('data-sy108-skip', '1');
      a.href = '/';
      a.textContent = '← ' + (LANG === 'en' ? 'Device status' : '设备状态');
      document.body.appendChild(a);
    }
    if (!document.querySelector('.sy108-lang')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sy108-lang';
      b.setAttribute('data-sy108-skip', '1');
      function label() { b.textContent = LANG === 'zh' ? 'EN 英文' : '中文 CN'; }
      label();
      b.title = LANG === 'zh' ? '切换到英文 / Switch to English' : '切换到中文 / Switch to Chinese';
      b.addEventListener('click', function () {
        LANG = LANG === 'zh' ? 'en' : 'zh';
        setck('sy108-lang', LANG);
        try { localStorage.setItem('sy108-lang', LANG); } catch (e) {}
        label();
        var back = document.querySelector('.sy108-back');
        if (back) back.textContent = '← ' + (LANG === 'en' ? 'Device status' : '设备状态');
        b.title = LANG === 'zh' ? '切换到英文 / Switch to English' : '切换到中文 / Switch to Chinese';
        if (observer) observer.disconnect();
        walk(document.body, LANG === 'en');
        if (observer) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      document.body.appendChild(b);
    }
  }

  var observer = null;
  function startObserver() {
    if (!window.MutationObserver) return;
    observer = new MutationObserver(function () {
      if (LANG !== 'en') return;
      observer.disconnect();
      walk(document.body, true);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function init() {
    addUI();
    if (LANG === 'en') walk(document.body, true);
    startObserver();
    // 上游重绘后可能重建 <title>
    if (LANG === 'en' && document.title.indexOf('信号看板') >= 0) {
      document.title = document.title.replace('信号看板', 'Signal dashboard');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
