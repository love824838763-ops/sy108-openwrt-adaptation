/* =============================================================
 * luci-guard.js v2 — LuCI 分级安全守卫（SY108 二次适配）
 *
 * 设计目标（v2 修订）：
 *   1. 只拦「真会锁死 / 变砖 / 丢配置」的动作，不再按页面一刀切：
 *      - 恢复出厂（需输入 RESET）
 *      - 刷写固件（需输入 FLASH）
 *      - 重启设备
 *      - 改动 USB 管理接口 usbmgmt（192.168.66.1）
 *      - 停用 / 禁用 udx-cellular 服务
 *      - 改动 dropbear / SSH 密钥 / uhttpd 这类远程管理入口
 *      其余保存（DHCP、无线、端口转发、防火墙规则、密码等）一律静默放行。
 *   2. 点击级拦截优先：确认通过后放行同一次点击，不再「重放按钮」，
 *      避免刷机页丢文件、重置页重复弹窗。
 *   3. confirm() 覆盖只做兜底：仅匹配恢复出厂 / 刷机 / 重启三类文案；
 *      刚在点击级确认过的同类动作 4 秒内不再二次询问。
 *   4. 弹窗只做一层：ESC / 遮罩 / 关闭按钮均可取消，焦点锁定在弹窗内，
 *      取消后把焦点还给原按钮。
 *
 * 不改动 LuCI / 上游业务代码。部署：主题 footer.ut 追加 <script defer>。
 * ============================================================= */
(function () {
  'use strict';

  if (!/\/cgi-bin\/luci\//.test(location.pathname) && !/\/luci\//.test(location.pathname)) return;

  /* ---------------- 语言（与状态页共用 cookie） ---------------- */
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
  function T(zh, en) { return LANG === 'en' ? en : zh; }

  /* ---------------- 页面判定 ----------------
   * Outline 主题在 <body data-page="admin-system-reboot"> 上给了稳定标识，
   * 优先用它；拿不到再退回路径匹配（兼容 Aurora 与旧版）。
   */
  function pageId() {
    var p = (document.body && document.body.getAttribute('data-page')) || '';
    if (p) return p;
    var m = location.pathname.match(/\/admin\/(.+?)\/?$/);
    return m ? 'admin-' + m[1].replace(/\//g, '-') : '';
  }

  /* ---------------- 危险动作定义 ---------------- */
  var RULES = {
    reset: {
      id: 'reset', level: 'critical', word: 'RESET', ack: true,
      title: T('恢复出厂设置', 'Factory reset'),
      tag: T('不可撤销', 'IRREVERSIBLE'),
      forbid: T(
        '不要在设备正给电脑供网、或刚刷完机还没验证 USB 与 SIM 时执行；也不要用「不保留配置」的固件升级来代替它。',
        'Do not run this while the device is providing the PC’s internet link, or right after a flash before USB and SIM are verified. Do not substitute a firmware upgrade with "do not keep settings".'),
      effect: T(
        '清空全部 OpenWrt 配置并重启：自动 APN、智能选频、免登录状态页、断网提示、本分级提醒、累计流量与耗电记录都会消失；登录密码重置为 admin。SSH 主机密钥与产线校准 NV 保留。设备约 1–3 分钟不可用，恢复后需重新插卡并重启一次才会识别 SIM。',
        'All OpenWrt configuration is wiped and the device reboots. Automatic APN, smart band selection, the sign-in-free status page, offline notice, these guardrails and accumulated traffic/energy counters are lost; the login password returns to admin. SSH host keys and factory calibration NV are kept. Expect 1–3 minutes offline, and one reboot after re-inserting the SIM before it is detected.'),
      ok: T('确认恢复出厂', 'Reset device')
    },
    flash: {
      id: 'flash', level: 'critical', word: 'FLASH', ack: true,
      title: T('刷写固件', 'Flash firmware'),
      tag: T('可能导致变砖', 'CAN BRICK'),
      forbid: T(
        '不要刷入其它机型的分区 XML 或固件（例如 R106 版）：trustos 尺寸不同，ubipac 偏移会差约 1.75 MiB；不要在没有完整镜像备份时勾选「不保留配置」。',
        'Never flash partition XML or images from another model (e.g. the R106 variant): trustos size differs and the ubipac offset shifts by ~1.75 MiB. Never pick "do not keep settings" without a full image backup.'),
      effect: T(
        '分区写错会直接变砖，splloader 在 mtd0 上没有备份分区，只能靠 FDL 与完整镜像救回。刷机还会覆盖本次适配的全部脚本与页面。',
        'A wrong partition image bricks the device; splloader on mtd0 has no backup partition and recovery needs FDL tooling plus full dumps. Flashing also overwrites every script and page of this adaptation.'),
      ok: T('确认刷写', 'Flash now')
    },
    reboot: {
      id: 'reboot', level: 'danger',
      title: T('重启设备', 'Reboot device'),
      tag: T('会短暂断网', 'BRIEF OUTAGE'),
      forbid: T(
        '不要在频段扫描、APN 切换或固件写入过程中重启；不要用 stop udx-cellular 当作「重连」（会触发 PMIC 看门狗硬重启）。',
        'Do not reboot during a band scan, APN switch or firmware write. Never use "stop udx-cellular" as a reconnect — it triggers a PMIC watchdog hard reset.'),
      effect: T(
        'USB 网络与状态页中断约 1–2 分钟；若有未保存的改动会丢失。插卡后若一直搜不到网，重启一次可让基带重新枚举 SIM。',
        'USB networking and the status page drop for about 1–2 minutes; unsaved changes are lost. If the modem cannot find the network after inserting a SIM, one reboot makes it re-enumerate the SIM.'),
      ok: T('确认重启', 'Reboot')
    },
    usbmgmt: {
      id: 'usbmgmt', level: 'danger',
      title: T('改动 USB 管理接口', 'Change USB management interface'),
      tag: T('可能失去管理入口', 'MAY LOSE ACCESS'),
      forbid: T(
        '不要改 usbmgmt 的 IP（192.168.66.1）、不要改它的协议类型、不要禁用该接口；也不要动 /mnt/data/mode.cfg 里的 USB 复合模式。',
        'Do not change the usbmgmt IP (192.168.66.1), its protocol, or disable the interface. Do not touch the USB composite mode in /mnt/data/mode.cfg either.'),
      effect: T(
        '改错会立刻失去网页与 SSH 管理入口，只能靠串口或 FDL 救砖。若确实要改，请先确认 USB 口与线缆可用，并准备好救砖镜像。',
        'A wrong value immediately removes both web and SSH access, leaving only serial or FDL recovery. If you really need to change it, verify the USB port and cable first and have the recovery images ready.'),
      ok: T('我了解风险，继续', 'I understand, continue')
    },
    cellular: {
      id: 'cellular', level: 'danger',
      title: T('停用蜂窝服务', 'Stop the cellular service'),
      tag: T('会触发硬重启', 'HARD RESET RISK'),
      forbid: T(
        '不要停用或禁用 udx-cellular；要重连网络请用 apn-auto apply 或重启设备。',
        'Do not stop or disable udx-cellular. To reconnect, use apn-auto apply or reboot the device.'),
      effect: T(
        '停用该服务会触发 PMIC 看门狗硬重启，设备在重启完成前不可访问；正在进行的下载与配置写入也会中断。',
        'Stopping it triggers a PMIC watchdog hard reset and the device is unreachable until it finishes rebooting; ongoing downloads and config writes are interrupted.'),
      ok: T('我了解风险，继续', 'I understand, continue')
    },
    ssh: {
      id: 'ssh', level: 'danger',
      title: T('改动远程管理入口', 'Change remote management access'),
      tag: T('可能锁死自己', 'MAY LOCK YOU OUT'),
      forbid: T(
        '不要关闭 dropbear、不要删掉唯一可用的 SSH 公钥、不要把 uhttpd 的监听端口改到未知端口。',
        'Do not disable dropbear, do not remove the only working SSH key, and do not move uhttpd to an unknown port.'),
      effect: T(
        '改错后网页与 SSH 可能同时进不去，只能靠串口或 FDL 恢复；已登录的会话也会在下次重连时失效。',
        'A wrong change can lock you out of both the web UI and SSH, leaving serial or FDL recovery; existing sessions also fail on the next reconnect.'),
      ok: T('我了解风险，继续', 'I understand, continue')
    }
  };

  var SAVE_RE = /save|apply|保存|应用|提交|write|写入/i;
  var BTN_SEL = 'button, a, input[type="submit"], input[type="button"], .cbi-button, [role="button"]';

  function btnText(el) {
    if (!el) return '';
    return ((el.textContent || '') + ' ' + (el.value || '') + ' ' + (el.getAttribute('title') || '') + ' ' +
      (el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  /* 编辑框里出现 192.168.66.x 或 usbmgmt 才算「正在改管理接口」 */
  function mgmtEditing() {
    var nodes = document.querySelectorAll('#modal_overlay input, .modal input, .cbi-input-text, input[type="text"]');
    var n = Math.min(nodes.length, 200);
    for (var i = 0; i < n; i++) {
      var v = nodes[i].value || '';
      if (v === 'usbmgmt' || /^192\.168\.66\./.test(v)) return true;
    }
    var m = document.querySelector('#modal_overlay, .modal');
    return !!(m && /usbmgmt|192\.168\.66\./.test(m.textContent || ''));
  }

  function rowOrPageHas(el, word) {
    var n = el, i = 0;
    while (n && n !== document.body && i++ < 7) {
      if ((n.textContent || '').toLowerCase().indexOf(word) >= 0) return true;
      n = n.parentElement;
    }
    return (document.body.textContent || '').toLowerCase().indexOf(word) >= 0;
  }

  /* ---------------- 点击该交给哪条规则 ---------------- */
  function ruleForClick(el) {
    var p = pageId(), t = btnText(el);

    if (p === 'admin-system-maintenance') {
      if (/firstboot|factory|erase|reset|恢复出厂|清除配置/i.test(t)) return RULES.reset;
      if (/reboot|重启/i.test(t)) return RULES.reboot;
      return null;
    }
    if (p === 'admin-system-flash') {
      if (/flash|upgrade|刷写|升级/i.test(t)) return RULES.flash;
      return null;
    }
    if (p === 'admin-system-reboot') {
      if (/reboot|restart|重启/i.test(t)) return RULES.reboot;
      return null;
    }
    if (p === 'admin-network-network') {
      if (!SAVE_RE.test(t)) return null;
      return mgmtEditing() ? RULES.usbmgmt : null;   /* 其它接口：静默 */
    }
    if (p === 'admin-system-startup') {
      var stop = /stop|disable|禁用|停用|restart|重启/i.test(t);
      if (!SAVE_RE.test(t) && !stop) return null;
      return rowOrPageHas(el, 'udx-cellular') ? RULES.cellular : null;
    }
    if (p === 'admin-system-dropbear' || p === 'admin-system-sshkeys' || p === 'admin-system-uhttpd') {
      if (!SAVE_RE.test(t) && !/delete|remove|删除/i.test(t)) return null;
      return RULES.ssh;
    }
    return null;
  }

  /* ---------------- confirm() 兜底匹配（只认三类） ---------------- */
  var CONFIRM_RULES = [
    { r: /erase all settings|clear the openwrt configuration|factory reset|firstboot|login password will be reset|恢复出厂/i, id: 'reset' },
    { r: /sysupgrade|flash (?:image|firmware)|firmware upgrade|do not keep.*settings|刷写固件/i, id: 'flash' },
    { r: /perform reboot|reboots the operating system|reboot (?:the )?(?:device|system)|确认重启/i, id: 'reboot' }
  ];
  function ruleForConfirm(msg) {
    var s = String(msg || '');
    for (var i = 0; i < CONFIRM_RULES.length; i++) {
      if (CONFIRM_RULES[i].r.test(s)) return RULES[CONFIRM_RULES[i].id];
    }
    return null;
  }

  /* ---------------- 样式 ---------------- */
  var CSS = [
    '.sy108-g-mask{position:fixed;inset:0;z-index:100000;background:rgba(8,12,20,.55);display:flex;align-items:center;justify-content:center;padding:16px;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
    '.sy108-g-box{width:100%;max-width:500px;max-height:88vh;display:flex;flex-direction:column;background:#fff;color:#16202f;border-radius:14px;',
    'border:1px solid #e3e9f2;box-shadow:0 18px 48px rgba(8,12,20,.32);overflow:hidden;animation:sy108g .16s ease-out}',
    '@keyframes sy108g{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}',
    '.sy108-g-hd{display:flex;align-items:flex-start;gap:11px;padding:15px 16px 13px;border-bottom:1px solid #eef2f8;',
    'border-top:3px solid var(--g-accent,#d33c39)}',
    '.sy108-g-ic{width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;font-size:17px;font-weight:800;',
    'background:var(--g-soft,#fdeceb);color:var(--g-accent,#d33c39)}',
    '.sy108-g-tt{flex:1;min-width:0}',
    '.sy108-g-t{font-size:15.5px;font-weight:750;line-height:1.35;margin:0}',
    '.sy108-g-meta{margin-top:5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
    '.sy108-g-tag{font-size:10.5px;font-weight:750;letter-spacing:.3px;padding:2px 7px;border-radius:5px;',
    'background:var(--g-soft,#fdeceb);color:var(--g-accent,#d33c39)}',
    '.sy108-g-lv{font-size:11px;color:#7c8798}',
    '.sy108-g-x{flex:none;width:26px;height:26px;border:0;background:transparent;color:#95a1b2;font-size:19px;line-height:1;',
    'cursor:pointer;border-radius:7px}',
    '.sy108-g-x:hover{background:#f1f4f9;color:#5a687c}',
    '.sy108-g-bd{padding:14px 16px 4px;overflow:auto;flex:1}',
    '.sy108-g-sec{margin-bottom:12px;border-radius:9px;padding:10px 12px;border-left:3px solid transparent}',
    '.sy108-g-sec.forbid{background:#fdf0ef;border-left-color:#d33c39}',
    '.sy108-g-sec.effect{background:#fff6e8;border-left-color:#cf8306}',
    '.sy108-g-sec h4{margin:0 0 5px;font-size:11.5px;font-weight:750;letter-spacing:.2px;display:flex;align-items:center;gap:6px}',
    '.sy108-g-sec.forbid h4{color:#a82b28}',
    '.sy108-g-sec.effect h4{color:#94590a}',
    '.sy108-g-sec p{margin:0;font-size:12.5px;line-height:1.7;color:#48566d}',
    '.sy108-g-ack{background:#f5f7fb;border:1px solid #e3e9f2;border-radius:9px;padding:10px 12px}',
    '.sy108-g-ack label{display:flex;gap:8px;font-size:12.5px;line-height:1.6;color:#48566d;cursor:pointer;align-items:flex-start}',
    '.sy108-g-ack input[type=checkbox]{width:15px;height:15px;margin:2px 0 0;flex:none}',
    '.sy108-g-ack input[type=text]{width:100%;box-sizing:border-box;margin-top:9px;padding:8px 10px;font-size:13px;',
    'border:1px solid #dbe2ec;border-radius:8px;font-family:inherit;letter-spacing:1px}',
    '.sy108-g-ack input[type=text]:focus{outline:2px solid rgba(211,60,57,.25);border-color:#d33c39}',
    '.sy108-g-hint{margin-top:7px;font-size:11.5px;color:#8a96a7}',
    '.sy108-g-ft{display:flex;gap:9px;padding:12px 16px 15px;border-top:1px solid #eef2f8;background:#fcfdff}',
    '.sy108-g-ft button{flex:1;border-radius:9px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer;',
    'border:1px solid #dbe2ec;background:#fff;color:#54617a;font-family:inherit}',
    '.sy108-g-ft button:hover{background:#f4f7fc}',
    '.sy108-g-ft button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(96,128,190,.35)}',
    '.sy108-g-x:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(96,128,190,.3)}',
    '.sy108-g-ft button.ok{background:var(--g-accent,#d33c39);color:#fff;border-color:transparent}',
    '.sy108-g-ft button.ok:hover{filter:brightness(1.06)}',
    '.sy108-g-ft button.ok:focus-visible{box-shadow:0 0 0 3px rgba(211,60,57,.3)}',
    '.sy108-g-ft button.ok:disabled{background:#e9edf4;color:#a6b0c0;border-color:#e9edf4;opacity:1;filter:none;cursor:not-allowed}',
    '.sy108-g-bar{margin:0 0 14px;border:1px solid #f0dfc2;background:#fffcf4;border-radius:10px;padding:9px 13px;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:12.5px;color:#5c6678}',
    '.sy108-g-bar summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:650;color:#8a5b12}',
    '.sy108-g-bar summary::-webkit-details-marker{display:none}',
    '.sy108-g-bar .tag{background:#fbeccd;color:#8a5b12;border-radius:5px;padding:1px 6px;font-size:10.5px;font-weight:750}',
    '.sy108-g-bar .caret{color:#b99a63;font-size:11px;transition:transform .15s}',
    '.sy108-g-bar[open] .caret{transform:rotate(90deg)}',
    '.sy108-g-bar .more{color:#a08a63;font-weight:500}',
    '.sy108-g-bar[open] .more{display:none}',
    '.sy108-g-bar dl{margin:9px 0 0;line-height:1.65}',
    '.sy108-g-bar dt{font-weight:750;color:#8a5b12;font-size:11.5px;margin-top:7px}',
    '.sy108-g-bar dd{margin:2px 0 0;font-size:12px;color:#5c6678}',
    '.sy108-g-bar-ft{display:flex;justify-content:flex-end;margin-top:11px}',
    '.sy108-g-ackbtn{border:1px solid #e2d2ae;background:#fdf6e6;color:#8a5b12;border-radius:7px;padding:5px 13px;',
    'font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}',
    '.sy108-g-ackbtn:hover{background:#fbeccd}',
    '.sy108-g-ackbtn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(96,128,190,.3)}',
    '.sy108-g-lang{position:fixed;left:14px;bottom:14px;z-index:9998;border:1px solid #dbe2ec;background:#fff;color:#66738a;',
    'border-radius:9px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;opacity:.85}',
    '.sy108-g-lang:hover{opacity:1}',
    ':root[data-darkmode="true"] .sy108-g-box{background:#161d28;color:#e8eef8;border-color:#2a3546}',
    ':root[data-darkmode="true"] .sy108-g-hd{border-bottom-color:#242f3e}',
    ':root[data-darkmode="true"] .sy108-g-x{color:#7d8ba0}',
    ':root[data-darkmode="true"] .sy108-g-x:hover{background:#212b3a;color:#c9d4e4}',
    ':root[data-darkmode="true"] .sy108-g-sec.forbid{background:#2a1c1e}',
    ':root[data-darkmode="true"] .sy108-g-sec.effect{background:#2a2318}',
    ':root[data-darkmode="true"] .sy108-g-sec p{color:#b3c0d3}',
    ':root[data-darkmode="true"] .sy108-g-ack{background:#1c2534;border-color:#2a3546}',
    ':root[data-darkmode="true"] .sy108-g-ack label{color:#b3c0d3}',
    ':root[data-darkmode="true"] .sy108-g-ack input[type=text]{background:#101823;border-color:#2f3b4d;color:#e8eef8}',
    ':root[data-darkmode="true"] .sy108-g-ft{background:#131a24;border-top-color:#242f3e}',
    ':root[data-darkmode="true"] .sy108-g-ft button{background:#1e2836;border-color:#2f3b4d;color:#a9b7ca}',
    ':root[data-darkmode="true"] .sy108-g-ft button:hover{background:#25313f}',
    ':root[data-darkmode="true"] .sy108-g-ft button.ok:disabled{background:#232d3c;color:#6d7b8f;border-color:#232d3c}',
    ':root[data-darkmode="true"] .sy108-g-bar{background:#241f16;border-color:#453a24;color:#b0bccd}',
    ':root[data-darkmode="true"] .sy108-g-bar dd{color:#b0bccd}',
    ':root[data-darkmode="true"] .sy108-g-ackbtn{background:#33291a;border-color:#4a3c24;color:#dfb87c}',
    ':root[data-darkmode="true"] .sy108-g-ackbtn:hover{background:#3d301d}',
    ':root[data-darkmode="true"] .sy108-g-lang{background:#1e2836;border-color:#2f3b4d;color:#a9b7ca}',
    '@media (prefers-color-scheme:dark){:root:not([data-darkmode]) .sy108-g-box{background:#161d28;color:#e8eef8;border-color:#2a3546}}',
    '@media (max-width:520px){.sy108-g-box{max-height:92vh}.sy108-g-ft{flex-direction:column-reverse}}'
  ].join('');

  var st = document.createElement('style');
  st.setAttribute('data-sy108-guard', '1');
  st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);

  /* ---------------- 弹窗 ---------------- */
  var openMask = null, lastFocus = null;

  function closeModal() {
    if (!openMask) return;
    var m = openMask;
    openMask = null;
    if (m._esc) document.removeEventListener('keydown', m._esc, true);
    if (m.parentNode) m.parentNode.removeChild(m);
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      try { lastFocus.focus(); } catch (e) {}
    }
    lastFocus = null;
  }

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function showDanger(rule, onOk) {
    if (openMask) return;                       /* 已有弹窗：忽略重复触发 */
    lastFocus = document.activeElement;

    var mask = el('div', 'sy108-g-mask');
    var box = el('div', 'sy108-g-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.style.setProperty('--g-accent', rule.level === 'critical' ? '#d33c39' : '#c97611');
    box.style.setProperty('--g-soft', rule.level === 'critical' ? '#fdeceb' : '#fdf1e0');

    /* 头部 */
    var hd = el('div', 'sy108-g-hd');
    hd.appendChild(el('span', 'sy108-g-ic', '!'));
    var tt = el('div', 'sy108-g-tt');
    var t = el('h3', 'sy108-g-t', rule.title);
    t.id = 'sy108-g-title';
    tt.appendChild(t);
    var meta = el('div', 'sy108-g-meta');
    meta.appendChild(el('span', 'sy108-g-tag', rule.tag));
    meta.appendChild(el('span', 'sy108-g-lv',
      rule.level === 'critical' ? T('最高危险 · 需二次确认', 'Critical · double confirmation') :
        T('高风险 · 请确认', 'High risk · please confirm')));
    tt.appendChild(meta);
    hd.appendChild(tt);
    var x = el('button', 'sy108-g-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', T('关闭', 'Close'));
    hd.appendChild(x);
    box.appendChild(hd);

    /* 正文 */
    var bd = el('div', 'sy108-g-bd');
    bd.id = 'sy108-g-desc';

    var s1 = el('div', 'sy108-g-sec forbid');
    s1.appendChild(el('h4', null, '✕ ' + T('不能怎么设置', 'What NOT to do')));
    s1.appendChild(el('p', null, rule.forbid));
    bd.appendChild(s1);

    var s2 = el('div', 'sy108-g-sec effect');
    s2.appendChild(el('h4', null, '! ' + T('设置后会导致什么', 'What will happen')));
    s2.appendChild(el('p', null, rule.effect));
    bd.appendChild(s2);

    var okBtn, chk = null, inp = null;
    if (rule.ack) {
      var ack = el('div', 'sy108-g-sec sy108-g-ack');
      var lab = el('label');
      chk = el('input');
      chk.type = 'checkbox';
      lab.appendChild(chk);
      lab.appendChild(document.createTextNode(T(
        ' 我已读完以上说明，知道后果并愿意继续。',
        ' I have read the notes above, understand the consequences and want to proceed.')));
      ack.appendChild(lab);
      if (rule.word) {
        ack.appendChild(el('div', 'sy108-g-hint', T('请在下方输入 ' + rule.word + ' 确认：', 'Type ' + rule.word + ' below to confirm:')));
        inp = el('input');
        inp.type = 'text';
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.placeholder = rule.word;
        inp.setAttribute('aria-label', T('确认词', 'Confirmation word'));
        ack.appendChild(inp);
      }
      bd.appendChild(ack);
    }
    box.appendChild(bd);

    /* 底部 */
    var ft = el('div', 'sy108-g-ft');
    var cancel = el('button', null, T('取消，不做改动', 'Cancel, change nothing'));
    cancel.type = 'button';
    okBtn = el('button', 'ok', rule.ok || T('确认继续', 'Confirm'));
    okBtn.type = 'button';
    okBtn.disabled = !!rule.ack;
    ft.appendChild(cancel);
    ft.appendChild(okBtn);
    box.appendChild(ft);

    mask.appendChild(box);
    document.body.appendChild(mask);
    openMask = mask;

    function validate() {
      if (!rule.ack) { okBtn.disabled = false; return; }
      okBtn.disabled = !(chk && chk.checked && (!rule.word || (inp && inp.value.trim().toUpperCase() === rule.word)));
    }
    if (chk) chk.addEventListener('change', validate);
    if (inp) inp.addEventListener('input', validate);
    validate();

    cancel.addEventListener('click', closeModal);
    x.addEventListener('click', closeModal);
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });

    okBtn.addEventListener('click', function () {
      if (okBtn.disabled) return;
      closeModal();
      try { onOk(); } catch (e) {}
    });

    /* 焦点锁在弹窗内 */
    mask._esc = function (e) {
      if (!openMask) return;
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      var f = box.querySelectorAll('button, input, a[href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', mask._esc, true);

    (inp || chk || cancel).focus();
  }

  /* ---------------- 点击级拦截（主路径） ---------------- */
  /* 确认通过后标记该按钮，下一次点击直接放行，不重放、不二次弹窗 */
  var recent = null;      /* { id, ts } */

  document.addEventListener('click', function (e) {
    var el2 = e.target && e.target.closest ? e.target.closest(BTN_SEL) : null;
    if (!el2 || el2.getAttribute('data-sy108-skip') === '1') return;

    var rule = ruleForClick(el2);
    if (!rule) return;                                   /* 普通动作：放行 */

    if (el2.__sy108Pass === rule.id) {                   /* 已确认：放行本次 */
      el2.__sy108Pass = null;
      return;
    }
    if (recent && recent.id === rule.id && Date.now() - recent.ts < 2500) {
      recent = null;                                     /* 刚确认过同类：放行 */
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    showDanger(rule, function () {
      recent = { id: rule.id, ts: Date.now() };
      el2.__sy108Pass = rule.id;
      el2.click();
    });
  }, true);

  /* ---------------- confirm() 兜底（不重放则提示重点一次） ---------------- */
  var nativeConfirm = window.confirm;
  var retryRule = null, retryUntil = 0;
  var lastClickEl = null, lastClickTs = 0;

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest(BTN_SEL) : null;
    if (b) { lastClickEl = b; lastClickTs = Date.now(); }
  }, true);

  function toast(msg) {
    var id = 'sy108-g-toast';
    var old = document.getElementById(id);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = el('div', null, msg);
    d.id = id;
    d.setAttribute('data-sy108-skip', '1');
    d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100001;' +
      'background:#16202f;color:#fff;border-radius:9px;padding:10px 15px;font-size:12.5px;max-width:88vw;' +
      'text-align:center;box-shadow:0 8px 22px rgba(0,0,0,.26)';
    document.body.appendChild(d);
    window.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 6500);
  }

  window.confirm = function (msg) {
    var rule = ruleForConfirm(msg);
    if (!rule) return nativeConfirm ? nativeConfirm.call(window, msg) : true;

    if (recent && recent.id === rule.id && Date.now() - recent.ts < 4000) {
      recent = null;                                     /* 点击级刚确认过 */
      return true;
    }
    if (retryRule === rule.id && Date.now() < retryUntil) {
      retryRule = null;
      return true;                                       /* 15 秒内重点同一动作 */
    }

    var target = (lastClickEl && document.contains(lastClickEl) &&
      (Date.now() - lastClickTs) < 15000 && typeof lastClickEl.click === 'function') ? lastClickEl : null;

    showDanger(rule, function () {
      if (target) {
        recent = { id: rule.id, ts: Date.now() };
        target.__sy108Pass = rule.id;
        target.click();
      } else {
        retryRule = rule.id;
        retryUntil = Date.now() + 15000;
        toast(T('请在 15 秒内再点一次刚才的按钮，以继续本次操作。',
          'Click the same button again within 15 seconds to continue.'));
      }
    });
    return false;
  };

  /* ---------------- 常驻旁注（只在这些页面出现，中性提示，不喧宾夺主） ---------------- */
  var NOTE = {
    'admin-system-maintenance': ['reset', 'reboot'],
    'admin-system-flash': ['flash'],
    'admin-system-reboot': ['reboot'],
    'admin-network-network': ['usbmgmt'],
    'admin-system-startup': ['cellular'],
    'admin-system-dropbear': ['ssh'],
    'admin-system-sshkeys': ['ssh'],
    'admin-system-uhttpd': ['ssh']
  };
  var barEl = null, barKey = null;

  /* 是否已「知道了」：按页面记在 localStorage，取不到就退回 cookie */
  function ackKey(p) { return 'sy108-guard-ack:' + p; }
  function isAcked(p) {
    try { if (localStorage.getItem(ackKey(p)) === '1') return true; } catch (e) {}
    return ('; ' + document.cookie).indexOf('; ' + ackKey(p) + '=1') >= 0;
  }
  function setAcked(p) {
    try { localStorage.setItem(ackKey(p), '1'); } catch (e) {}
    try { document.cookie = ackKey(p) + '=1;path=/;max-age=31536000;SameSite=Lax'; } catch (e) {}
  }

  function buildBar(ids, page) {
    var d = document.createElement('details');
    d.className = 'sy108-g-bar';
    d.open = !isAcked(page);          /* 第一次进页面：默认展开 */

    var s = document.createElement('summary');
    s.appendChild(el('span', 'tag', T('红线提醒', 'NOTES')));
    s.appendChild(document.createTextNode(T('本页有高风险设置', 'High-risk settings on this page')));
    s.appendChild(el('span', 'more', T(' · 点开查看', ' · expand')));
    s.appendChild(el('span', 'caret', '▸'));
    d.appendChild(s);

    var dl = document.createElement('dl');
    ids.forEach(function (id) {
      var r = RULES[id];
      dl.appendChild(el('dt', null, '✕ ' + T('不能怎么设置', 'What NOT to do') + ' · ' + r.title));
      dl.appendChild(el('dd', null, r.forbid));
      dl.appendChild(el('dt', null, '! ' + T('会导致什么', 'What happens')));
      dl.appendChild(el('dd', null, r.effect));
    });
    d.appendChild(dl);

    var ft = el('div', 'sy108-g-bar-ft');
    var ack = el('button', 'sy108-g-ackbtn', T('知道了', 'Got it'));
    ack.type = 'button';
    ack.addEventListener('click', function (e) {
      e.preventDefault();
      setAcked(page);
      d.open = false;
    });
    ft.appendChild(ack);
    d.appendChild(ft);

    /* 用户自己点过标题（展开或收起）就记住，下次不再自动弹开；
       不监听 toggle，避免程序性 open 被误判成用户已读 */
    s.addEventListener('click', function () {
      window.setTimeout(function () { setAcked(page); }, 0);
    });

    return d;
  }

  function refreshBar() {
    var p = pageId();
    var ids = NOTE[p];
    var key = ids ? ids.join(',') : '';
    if (key === barKey) return;
    barKey = key;
    if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl);
    barEl = null;
    if (!ids) return;
    var host = document.querySelector('#maincontent, .maincontent, #content, main, .cbi-map, .container');
    if (!host) return;
    barEl = buildBar(ids, p);
    host.insertBefore(barEl, host.firstChild);
  }

  /* ---------------- 语言按钮（挪到左下，避免压住右下角「保存并应用」） ---------------- */
  function addLangBtn() {
    if (document.querySelector('.sy108-g-lang')) return;
    var b = el('button', 'sy108-g-lang', LANG === 'zh' ? 'EN' : '中文');
    b.type = 'button';
    b.title = T('切换提醒文字语言', 'Switch guard language');
    b.addEventListener('click', function () {
      LANG = LANG === 'zh' ? 'en' : 'zh';
      setck('sy108-lang', LANG);
      b.textContent = LANG === 'zh' ? 'EN' : '中文';
      barKey = '__force__';
      refreshBar();
    });
    document.body.appendChild(b);
  }

  /* 供本地自检使用（只读） */
  window.__SY108_GUARD__ = {
    rules: RULES,
    pageId: pageId,
    ruleForClick: ruleForClick,
    ruleForConfirm: ruleForConfirm
  };

  function init() { refreshBar(); addLangBtn(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.setInterval(refreshBar, 1500);
})();
