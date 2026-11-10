/* =============================================================
 * luci-guard.js — LuCI 分级安全守卫（SY108 二次适配）
 *
 * 目标：替代原先「一刀切全只读」的 rpcd ACL 锁。
 *   - 普通设置（语言 / 主题 / LED / 状态查看等）：完全不拦截、不询问
 *   - 危险操作确认：把浏览器原生 confirm() 升级成红色确认弹窗，
 *     旁边写明「不能怎么设置」与「设置后会导致什么」
 *   - 恢复出厂等最高危操作：额外要求输入确认词
 *   - 每个管理页常驻一条可折叠的安全旁注（按页面分类显示）
 *
 * 设计原则：不改动 LuCI / 上游业务代码，不拦截正常保存流程。
 * 只覆盖 window.confirm，用户确认后重新触发原点击，让上游逻辑原样执行。
 *
 * 部署：由主题 footer.ut 追加一行 <script defer src="..."> 引入。
 * ============================================================= */
(function () {
  'use strict';

  var path = location.pathname;
  if (!/\/cgi-bin\/luci\//.test(path) && !/\/luci\//.test(path)) return;

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

  /* ---------------- 危险等级规则 ----------------
   * re     : 匹配 window.confirm 的提示文案（上游多为英文）
   * paths  : 匹配 LuCI 管理页路径，用于旁注条分类
   * word   : 有值时要求输入该确认词（仅最高危）
   * forbid : 「不能怎么设置」
   * effect : 「设置后会导致什么」
   */
  var RULES = [
    {
      id: 'reset', level: 'critical', word: 'RESET',
      re: /clear the openwrt configuration|firstboot|factory reset|恢复出厂|清除配置|erase all settings|remove any installed packages|login password will be reset/i,
      paths: /maintenance|system\/flash|system\/reboot/,
      title: T('恢复出厂设置', 'Factory reset'),
      forbid: T(
        '不要在设备正在给电脑供网、或刚刷完机还没验证 USB 与 SIM 时执行；不要用「不保留配置」的固件升级来代替它。',
        'Do not run this while the device is providing the PC’s internet link, or before USB/SIM have been verified after a flash. Do not substitute a firmware upgrade with "do not keep settings".'),
      effect: T(
        '清除全部 OpenWrt 配置并重启：APN 自动识别、智能选频、免登录状态页、断网提示、本分级提醒、累计流量与耗电记录都会丢失；登录密码重置为 admin。SSH 主机密钥与产线校准 NV 保留。设备约 1–3 分钟不可用，恢复后需重新插卡并重启一次才会识别 SIM。',
        'All OpenWrt configuration is cleared and the device reboots. Automatic APN, smart band selection, the unauthenticated status page, offline notice, these guardrails and accumulated traffic/energy counters are all lost; the login password returns to admin. SSH host keys and factory calibration NV are kept. Expect 1–3 minutes of downtime, and a reboot after re-inserting the SIM before it is detected.')
    },
    {
      id: 'sysupgrade', level: 'critical', word: 'FLASH',
      re: /sysupgrade|flash.*firmware|upgrade.*firmware|do not keep.*settings|不保留配置|刷.*固件|固件升级/i,
      paths: /maintenance|system\/flash/,
      title: T('刷写 / 升级固件', 'Flash / upgrade firmware'),
      forbid: T(
        '不要刷入其它机型的分区 XML 或固件（例如 R106 版本）：trustos 尺寸不同，ubipac 偏移会差约 1.75 MiB；不要勾选「不保留配置」而不做备份。',
        'Never flash partition XML or firmware from another model (e.g. the R106 variant): trustos size differs and the ubipac offset shifts by about 1.75 MiB. Do not choose "do not keep settings" without a backup.'),
      effect: T(
        '写错分区会直接变砖，且 splloader 在 mtd0 上没有备份分区；恢复需要 FDL/救砖工具与完整镜像。刷机还会覆盖本次适配的所有脚本与页面。',
        'A wrong partition image bricks the device, and splloader on mtd0 has no backup partition. Recovery then requires FDL tooling and full dumps. Flashing also overwrites every script and page from this adaptation.')
    },
    {
      id: 'reboot', level: 'danger',
      re: /perform reboot|reboots the operating system|reboot\?|are you sure.*reboot|立即重启|确认重启/i,
      paths: /maintenance|system\/reboot/,
      title: T('重启设备', 'Reboot device'),
      forbid: T(
        '不要在频段扫描、APN 切换或固件写入过程中重启；不要用 stop udx-cellular 来「重连」（会触发 PMIC 看门狗硬重启）。',
        'Do not reboot during a band scan, APN switch or firmware write. Never use "stop udx-cellular" to reconnect — it triggers a PMIC watchdog hard reset.'),
      effect: T(
        'USB 网络与状态页会中断约 1–2 分钟。若开机时 /etc/bandlock.mode 残留了无覆盖的频段，会被锁死在没信号的频段上；当前版本已修复此问题。插卡后若一直搜不到网络，需重启一次让基带重新枚举 SIM。',
        'USB networking and the status page drop for about 1–2 minutes. If /etc/bandlock.mode is left on an uncovered band, the device would be locked to a dead band at boot (fixed in the current build). After inserting a SIM, one reboot is needed for the modem to enumerate it.')
    },
    {
      id: 'network', level: 'danger',
      re: /interface|firewall|dropbear|ssh key|network setting|网络设置|接口|防火墙/i,
      paths: /admin\/network|admin\/system\/(startup|crontab|dropbear|password|uhttpd|sshkeys)|admin\/services|admin\/firewall/,
      title: T('网络 / 系统关键设置', 'Network / critical system settings'),
      forbid: T(
        '不要改动 USB 网卡（usb0 / 192.168.66.1）的 IP、网关或禁用该接口；不要关闭 dropbear 的 SSH；不要修改 /mnt/data/mode.cfg 里的 USB 复合模式；不要停用 udx-cellular 服务。',
        'Do not change or disable the USB interface (usb0 / 192.168.66.1); do not turn off dropbear SSH; do not edit the USB composite mode in /mnt/data/mode.cfg; do not stop the udx-cellular service.'),
      effect: T(
        '改错 USB 网络会立刻失去网页与 SSH 管理能力，只能靠串口/FDL 救砖；停用蜂窝服务会触发 PMIC 看门狗硬重启；改 USB 模式可能让所有设备都识别不到网卡。',
        'A wrong USB network setting immediately removes both web and SSH access, leaving only serial/FDL recovery. Stopping the cellular service triggers a PMIC watchdog hard reset. Changing the USB mode can make the NIC disappear on every host.')
    },
    {
      id: 'generic-delete', level: 'danger',
      /* re 置空：泛指的 delete/remove 太容易误伤普通操作，
         这类沿用 LuCI 原生确认，不额外弹红色窗（不严重的不要询问）。 */
      re: null,
      title: T('删除 / 丢弃更改', 'Delete / discard changes'),
      forbid: T('不要在有未备份配置时批量删除。', 'Do not bulk-delete before backing up the configuration.'),
      effect: T('被删除的配置无法从网页撤销，需要 SSH 或恢复出厂才能找回。', 'Deleted settings cannot be undone from the web UI; SSH access or a factory reset is required.')
    }
  ];

  function matchConfirm(msg) {
    var s = String(msg || '');
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].re && RULES[i].re.test(s)) return RULES[i];
    }
    return null;
  }
  function matchPath(p) {
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].paths && RULES[i].paths.test(p)) return RULES[i];
    }
    return null;
  }

  /* ---------------- 样式（自注入，避免额外请求） ---------------- */
  var CSS = [
    '.sy108-guard-mask{position:fixed;inset:0;z-index:100000;background:rgba(10,14,22,.58);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(3px)}',
    '.sy108-guard-box{width:100%;max-width:520px;background:#fff;color:#162030;border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.35);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
    '.sy108-guard-hd{background:#dc3f3c;color:#fff;padding:15px 19px;display:flex;align-items:center;gap:10px;font-size:16px;font-weight:750}',
    '.sy108-guard-hd .ic{width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:17px;flex:none}',
    '.sy108-guard-bd{padding:18px 19px 6px;max-height:62vh;overflow:auto}',
    '.sy108-guard-sec{margin-bottom:15px}',
    '.sy108-guard-sec h4{font-size:12px;font-weight:750;margin:0 0 6px;letter-spacing:.3px}',
    '.sy108-guard-sec p{font-size:13px;line-height:1.72;margin:0;color:#42506a}',
    '.sy108-guard-sec.forbid{border-left:3px solid #dc3f3c;background:#fdecec;padding:10px 12px;border-radius:0 9px 9px 0}',
    '.sy108-guard-sec.forbid h4{color:#b52f2c}',
    '.sy108-guard-sec.effect{border-left:3px solid #d98405;background:#fff4e2;padding:10px 12px;border-radius:0 9px 9px 0}',
    '.sy108-guard-sec.effect h4{color:#a5640a}',
    '.sy108-guard-sec.q{background:#f4f6fb;border:1px solid #e5eaf2;border-radius:10px;padding:11px 12px}',
    '.sy108-guard-sec.q label{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.6;cursor:pointer;color:#42506a}',
    '.sy108-guard-sec.q input[type=checkbox]{margin-top:3px;flex:none;width:15px;height:15px}',
    '.sy108-guard-sec.q input[type=text]{width:100%;margin-top:9px;border:1px solid #e5eaf2;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;box-sizing:border-box}',
    '.sy108-guard-ft{display:flex;gap:9px;padding:13px 19px 18px;border-top:1px solid #eef2f8}',
    '.sy108-guard-ft button{flex:1;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:650;cursor:pointer;border:1px solid #e5eaf2;background:#fff;color:#5a687c;font-family:inherit}',
    '.sy108-guard-ft button.ok{background:#dc3f3c;color:#fff;border-color:transparent}',
    '.sy108-guard-ft button.ok:disabled{opacity:.45;cursor:not-allowed}',
    '.sy108-guard-bar{margin:0 0 14px;border:1px solid #f2c9c8;background:#fff8f8;border-radius:12px;padding:11px 14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:12.5px;color:#42506a}',
    '.sy108-guard-bar summary{cursor:pointer;font-weight:700;color:#b52f2c;list-style:none;display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
    '.sy108-guard-bar summary::-webkit-details-marker{display:none}',
    '.sy108-guard-bar .tag{background:#fdecec;color:#b52f2c;border-radius:6px;padding:1px 7px;font-size:10.5px;font-weight:700}',
    '.sy108-guard-bar dl{margin:11px 0 0;line-height:1.7}',
    '.sy108-guard-bar dt{font-weight:700;color:#a5640a;margin-top:8px;font-size:12px}',
    '.sy108-guard-bar dd{margin:2px 0 0;font-size:12px;color:#5a687c}',
    '.sy108-guard-bar .reset-link{display:inline-block;margin-top:10px;color:#dc3f3c;font-weight:650;text-decoration:underline;text-underline-offset:2px}',
    '.sy108-guard-lang{position:fixed;right:14px;bottom:14px;z-index:99998;border:1px solid #e5eaf2;background:#fff;color:#5a687c;border-radius:10px;padding:7px 11px;font-size:12px;font-weight:650;cursor:pointer;box-shadow:0 4px 14px rgba(18,30,55,.1)}',
    '@media (prefers-color-scheme:dark){.sy108-guard-box{background:#151c27;color:#e9eef7}.sy108-guard-ft{border-color:#263141}.sy108-guard-ft button{background:#1b2431;border-color:#263141;color:#a3b0c2}.sy108-guard-sec p{color:#a3b0c2}.sy108-guard-sec.q{background:#1b2431;border-color:#263141}.sy108-guard-sec.q label{color:#a3b0c2}.sy108-guard-sec.q input[type=text]{background:#0c1119;border-color:#263141;color:#e9eef7}.sy108-guard-bar{background:#24191b;border-color:#4a292a;color:#a3b0c2}.sy108-guard-bar dd{color:#a3b0c2}.sy108-guard-lang{background:#1b2431;border-color:#263141;color:#a3b0c2}}'
  ].join('\n');
  var st = document.createElement('style');
  st.setAttribute('data-sy108-guard', '1');
  st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);

  /* ---------------- 红色确认弹窗 ---------------- */
  function closeModal(mask) { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); }

  function showDanger(rule, onOk) {
    if (document.querySelector('.sy108-guard-mask')) return;
    var mask = document.createElement('div');
    mask.className = 'sy108-guard-mask';
    var box = document.createElement('div');
    box.className = 'sy108-guard-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    function sec(cls, head, body) {
      var d = document.createElement('div');
      d.className = 'sy108-guard-sec ' + cls;
      var h = document.createElement('h4'); h.textContent = head;
      var p = document.createElement('p'); p.textContent = body;
      d.appendChild(h); d.appendChild(p);
      return d;
    }

    var hd = document.createElement('div');
    hd.className = 'sy108-guard-hd';
    var ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = '!';
    hd.appendChild(ic);
    hd.appendChild(document.createTextNode(T('⚠ 危险操作确认：', '⚠ Dangerous action: ') + rule.title));
    box.appendChild(hd);

    var bd = document.createElement('div');
    bd.className = 'sy108-guard-bd';
    bd.appendChild(sec('forbid', T('不能怎么设置', 'What NOT to do'), rule.forbid));
    bd.appendChild(sec('effect', T('设置后会导致什么', 'What will happen'), rule.effect));

    var q = document.createElement('div'); q.className = 'sy108-guard-sec q';
    var okBtn, chk = null, inp = null;
    var lab = document.createElement('label');
    chk = document.createElement('input'); chk.type = 'checkbox';
    lab.appendChild(chk);
    lab.appendChild(document.createTextNode(' ' + T(
      '我已读完以上说明，知道后果并愿意继续。',
      'I have read the notes above, understand the consequences and want to proceed.')));
    q.appendChild(lab);

    if (rule.word) {
      var tip = document.createElement('div');
      tip.style.cssText = 'font-size:11.5px;color:#93a0b2;margin-top:8px';
      tip.textContent = T('请输入 ' + rule.word + ' 以确认：', 'Type ' + rule.word + ' to confirm:');
      q.appendChild(tip);
      inp = document.createElement('input');
      inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = rule.word;
      q.appendChild(inp);
    }
    bd.appendChild(q);
    box.appendChild(bd);

    var ft = document.createElement('div'); ft.className = 'sy108-guard-ft';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = T('取消（不做改动）', 'Cancel (no changes)');
    okBtn = document.createElement('button');
    okBtn.type = 'button'; okBtn.className = 'ok';
    okBtn.textContent = T('确认继续', 'Confirm and continue');
    okBtn.disabled = true;
    ft.appendChild(cancel); ft.appendChild(okBtn);
    box.appendChild(ft);
    mask.appendChild(box);
    document.body.appendChild(mask);

    function validate() {
      okBtn.disabled = !(chk.checked && (!rule.word || (inp && inp.value.trim() === rule.word)));
    }
    if (chk) chk.addEventListener('change', validate);
    if (inp) inp.addEventListener('input', validate);
    cancel.addEventListener('click', function () { closeModal(mask); });
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(mask); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { closeModal(mask); document.removeEventListener('keydown', esc); }
    });
    okBtn.addEventListener('click', function () {
      if (okBtn.disabled) return;
      closeModal(mask);
      try { onOk(); } catch (e) { /* 上游逻辑自行处理异常 */ }
    });
    (inp || chk).focus();
  }

  /* ---------------- 覆盖 window.confirm ----------------
   * 原生 confirm 是同步的：先返回 false 阻止本次操作，
   * 用户确认后重新触发同一个点击，第二次放行并让上游逻辑原样执行。
   * 若 confirm 并非来自可重试的点击（例如异步回调），绝不猜测按钮，
   * 改为「15 秒内再点一次同一按钮即放行」的手动重试，避免误触发别的操作。
   */
  var nativeConfirm = window.confirm;
  var bypass = false, bypassUntil = 0, lastEl = null, lastClickTs = 0;
  var BTN_SEL = 'button, a, input[type="submit"], input[type="button"], .cbi-button, [role="button"]';

  function toast(msg) {
    var id = 'sy108-guard-toast';
    var old = document.getElementById(id);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.id = id;
    d.setAttribute('data-sy108-skip', '1');
    d.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:100001;' +
      'background:#162030;color:#fff;border-radius:10px;padding:10px 16px;font-size:12.5px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:90vw;text-align:center';
    d.textContent = msg;
    document.body.appendChild(d);
    window.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 6000);
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    lastEl = (el && el.closest) ? el.closest(BTN_SEL) : null;
    lastClickTs = Date.now();
  }, true);

  window.confirm = function (msg) {
    var rule = matchConfirm(msg);
    if (!rule) return nativeConfirm.call(window, msg);   // 普通确认：保持原生、不打扰
    if (bypass) { bypass = false; return true; }         // 同一点击事件二次进入：放行
    if (Date.now() < bypassUntil) { bypassUntil = 0; return true; }  // 手动重试窗口

    // 只重试「最近一次点击、且仍在文档中」的按钮；异步来源一律不猜测
    var canRetry = lastEl && lastEl.isConnected !== false &&
                   (Date.now() - lastClickTs) < 15000 && typeof lastEl.click === 'function';
    var retry = canRetry ? lastEl : null;
    showDanger(rule, function () {
      if (retry) {
        bypass = true;
        retry.click();
      } else {
        bypassUntil = Date.now() + 15000;
        toast(T('请再点一次刚才的按钮，以继续本次操作。',
                'Please click the same button once more to continue.'));
      }
    });
    return false;
  };

  /* ---------------- 高危页面的「保存并应用」 ----------------
   * 这类按钮不调用 confirm，需单独在捕获阶段拦截；普通页面一律静默放行。
   */
  var DANGER_PATHS = /admin\/network|admin\/firewall|admin\/system\/(startup|crontab|dropbear|password|uhttpd|sshkeys)|admin\/services/;
  document.addEventListener('click', function (e) {
    if (!DANGER_PATHS.test(location.pathname + location.hash)) return;
    var el = e.target && e.target.closest ? e.target.closest(BTN_SEL) : null;
    if (!el) return;
    if (el.__sy108Allowed) { el.__sy108Allowed = false; return; }  // 确认后的第二次点击：放行
    var txt = ((el.textContent || el.value || '') + '').trim();
    if (!/save|apply|保存|应用|提交|submit|write|写入/i.test(txt)) return;
    var rule = matchPath(location.pathname + location.hash) || RULES[3];
    e.preventDefault();
    e.stopImmediatePropagation();
    showDanger(rule, function () {
      el.__sy108Allowed = true;
      el.click();
    });
  }, true);

  /* ---------------- 表单提交（补充拦截） ---------------- */
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.__sy108Allowed) { if (f) f.__sy108Allowed = false; return; }
    var rule = matchConfirm((f.getAttribute('onsubmit') || '') + ' ' + (f.textContent || '').slice(0, 200));
    if (!rule) return;                                   // 普通设置：静默放行
    e.preventDefault(); e.stopImmediatePropagation();
    showDanger(rule, function () {
      f.__sy108Allowed = true;
      if (typeof f.submit === 'function') f.submit();
    });
  }, true);

  /* ---------------- 常驻安全旁注条 ---------------- */
  function buildBar(rule) {
    var d = document.createElement('details');
    d.className = 'sy108-guard-bar';
    d.setAttribute('data-sy108-guard', '1');
    var s = document.createElement('summary');
    var tag = document.createElement('span'); tag.className = 'tag';
    tag.textContent = T('危险设置提醒', 'DANGER NOTES');
    s.appendChild(tag);
    s.appendChild(document.createTextNode(T(
      '本页涉及高风险设置 · 点开看「不能怎么设 / 会导致什么」',
      'This page contains high-risk settings · expand for what NOT to do and what happens')));
    d.appendChild(s);

    var dl = document.createElement('dl');
    var dt1 = document.createElement('dt'); dt1.textContent = T('不能怎么设置', 'What NOT to do');
    var dd1 = document.createElement('dd'); dd1.textContent = rule.forbid;
    var dt2 = document.createElement('dt'); dt2.textContent = T('设置后会导致什么', 'What will happen');
    var dd2 = document.createElement('dd'); dd2.textContent = rule.effect;
    dl.appendChild(dt1); dl.appendChild(dd1); dl.appendChild(dt2); dl.appendChild(dd2);
    d.appendChild(dl);

    var a = document.createElement('a');
    a.className = 'reset-link';
    a.href = '/cgi-bin/luci/admin/system/maintenance';
    a.textContent = T('→ 前往「恢复出厂设置 / 系统维护」', '→ Go to Factory reset / System maintenance');
    d.appendChild(a);
    return d;
  }

  var barRuleId = null, barEl = null;
  function refreshBar() {
    var cur = matchPath(location.pathname + location.hash + location.search);
    var id = cur ? cur.id : null;
    if (id === barRuleId) return;
    barRuleId = id;
    if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl);
    barEl = null;
    if (!cur) return;                                    // 普通页面：不显示任何提示
    var host = document.querySelector('#maincontent, .maincontent, #content, main, .cbi-map, .container');
    if (!host) return;
    barEl = buildBar(cur);
    host.insertBefore(barEl, host.firstChild);
  }

  /* ---------------- 语言切换按钮 ---------------- */
  function addLangBtn() {
    if (document.querySelector('.sy108-guard-lang')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sy108-guard-lang';
    function label() { b.textContent = LANG === 'zh' ? 'EN 英文' : '中文 CN'; }
    label();
    b.title = T('切换本页提醒文字的语言 / Switch guard text language', 'Switch guard text language');
    b.addEventListener('click', function () {
      LANG = LANG === 'zh' ? 'en' : 'zh';
      setck('sy108-lang', LANG);
      try { localStorage.setItem('sy108-lang', LANG); } catch (e) {}
      label();
      barRuleId = '__force__';
      refreshBar();
    });
    document.body.appendChild(b);
  }

  function init() { refreshBar(); addLangBtn(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // LuCI 是前端路由：URL 变化不会重载文档，定时同步旁注条
  window.setInterval(refreshBar, 1500);
})();
