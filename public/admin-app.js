(function() {
  var $ = function(sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var metricsData = null, waitlistData = null, ebooksData = null, accountsData = null, usageData = null, analyticsData = null, budgetData = null;
  var sortState = {};
  var firstLoad = true;
  var budgetAlertShown = {}; // track which provider alerts have played sound

  // ==================== THEME ====================
  var isLightMode = localStorage.getItem('gl-theme') === 'light';
  function applyTheme() {
    document.body.classList.toggle('light-mode', isLightMode);
    var icon = $('#themeIcon');
    if (isLightMode) {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.73 12.73l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    } else {
      icon.innerHTML = '<path d="M12 3a9 9 0 1 0 9 9c0-.5-.04-1-.13-1.5A5.5 5.5 0 0 1 13.5 3.13 9.1 9.1 0 0 0 12 3z"/>';
    }
  }
  applyTheme();
  $('#btnTheme').addEventListener('click', function() {
    isLightMode = !isLightMode;
    localStorage.setItem('gl-theme', isLightMode ? 'light' : 'dark');
    applyTheme();
    playClick();
  });

  // ==================== SOUND ====================
  var isMuted = localStorage.getItem('gl-muted') === 'true';
  var audioCtx = null, masterGain = null, droneOsc = null;

  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = isMuted ? 0 : 0.03;
      masterGain.connect(audioCtx.destination);
      startDrone();
    } catch(e) {}
  }
  function startDrone() {
    if (!audioCtx || droneOsc) return;
    var o = audioCtx.createOscillator(), g = audioCtx.createGain(), f = audioCtx.createBiquadFilter();
    o.type = 'sine'; o.frequency.value = 55;
    f.type = 'lowpass'; f.frequency.value = 120; g.gain.value = 0.4;
    o.connect(f); f.connect(g); g.connect(masterGain); o.start(); droneOsc = o;
    var lfo = audioCtx.createOscillator(), lg = audioCtx.createGain();
    lfo.frequency.value = 0.03; lg.gain.value = 8;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start();
  }
  function playClick() {
    if (!audioCtx || isMuted) return;
    try {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 800;
      g.gain.setValueAtTime(0.06, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      o.connect(g); g.connect(masterGain); o.start(); o.stop(audioCtx.currentTime + 0.08);
    } catch(e) {}
  }
  function playAlert() {
    if (!audioCtx || isMuted) return;
    try {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = 440;
      g.gain.setValueAtTime(0.1, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      o.connect(g); g.connect(masterGain); o.start();
      o.frequency.linearRampToValueAtTime(330, audioCtx.currentTime + 0.2);
      o.stop(audioCtx.currentTime + 0.4);
    } catch(e) {}
  }
  function updateSoundBtn() {
    var icon = $('#soundIcon'), btn = $('#btnSound');
    if (isMuted) {
      icon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/>';
      btn.classList.remove('active');
    } else {
      icon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.5 4.5 0 0 0 2.5-3.5zM14 3.23v2.06a6.5 6.5 0 0 1 0 13.42v2.06A8.5 8.5 0 0 0 14 3.23z"/>';
      btn.classList.add('active');
    }
    if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.03;
  }
  updateSoundBtn();
  $('#btnSound').addEventListener('click', function() {
    initAudio(); isMuted = !isMuted;
    localStorage.setItem('gl-muted', isMuted);
    updateSoundBtn(); if (!isMuted) playClick();
  });
  document.addEventListener('click', function init() { initAudio(); document.removeEventListener('click', init); }, { once: true });

  // ==================== REFRESH ====================
  $('#btnRefresh').addEventListener('click', function() { playClick(); fetchAll(); });

  // ==================== ANIMATED COUNTERS ====================
  function animateValue(el, end, duration) {
    if (!el) return;
    var endNum = parseFloat(String(end).replace(/[^0-9.-]/g, ''));
    if (isNaN(endNum) || endNum === 0) { el.textContent = end; return; }
    var suffix = String(end).replace(/[0-9.-]/g, '');
    var startTime = performance.now();
    function tick(now) {
      var p = Math.min((now - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * endNum) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = end;
    }
    requestAnimationFrame(tick);
  }

  function fadeInElements(sel, baseDelay) {
    $$(sel).forEach(function(el, i) { setTimeout(function() { el.classList.add('visible'); }, baseDelay + i * 80); });
  }

  // ==================== DATA FETCHING ====================
  async function fetchAll() {
    try {
      var r = await Promise.all([
        fetch('/api/admin/metrics'), fetch('/api/admin/waitlist'), fetch('/api/admin/ebooks'),
        fetch('/api/admin/accounts'), fetch('/api/admin/usage'), fetch('/api/admin/analytics'),
        fetch('/api/admin/budget')
      ]);
      if (r[0].status === 403 || r[1].status === 403) { window.location.href = '/'; return; }
      metricsData = await r[0].json(); waitlistData = await r[1].json(); ebooksData = await r[2].json();
      accountsData = await r[3].json(); usageData = await r[4].json(); analyticsData = await r[5].json();
      budgetData = await r[6].json();
      render();
      $('#lastRefresh').textContent = new Date().toLocaleTimeString();
    } catch (err) { console.error('Dashboard fetch failed:', err); }
  }

  // Fast budget-only refresh (every 15s between full refreshes)
  async function fetchBudgetOnly() {
    try {
      var r = await fetch('/api/admin/budget');
      if (r.status === 403) return;
      budgetData = await r.json();
      // Only re-render the budget sections
      var providerEl = document.getElementById('budget-providers');
      var budgetEl = document.getElementById('budget-detail');
      if (providerEl && budgetData) providerEl.innerHTML = renderProviderCards(budgetData, metricsData);
      if (budgetEl && budgetData) budgetEl.innerHTML = renderBudgetDetail(budgetData, usageData);
      updateResetCountdown();
    } catch (err) { /* silent */ }
  }

  function render() {
    if (!metricsData || !waitlistData || !ebooksData) return;
    var d = metricsData, w = waitlistData, e = ebooksData, a = accountsData, u = usageData, an = analyticsData;
    var grid = $('#dashboard');
    var b = budgetData;
    renderAlertBanner(u);
    renderKPIs(d, w, e, an);
    grid.innerHTML = [
      /* Row 2: Traffic + Live Visitors — side by side */
      renderTraffic(d, an), renderVisitorFeed(d),
      /* Row 3: Waitlist + Ebook — side by side */
      renderWaitlistOverview(w, d), renderEbookOverview(e),
      /* Row 4: Survey — full width */
      renderSurveyInsights(w),
      /* Row 5: Cover + Accounts — side by side */
      renderCoverStats(d), renderAccountsOverview(a),
      /* Row 6: LLM Providers with Budget — full width */
      renderProviders(d, b),
      /* Row 7: Budget Detail — full width */
      renderLlmUsage(u, d, b),
      /* Row 8: Errors + System — side by side */
      renderErrors(d, an), renderSystem(d),
      /* Row 9: Waitlist table — full width */
      renderWaitlistTable(w),
      /* Row 10: Ebook table — full width */
      renderEbookTable(e),
      /* Row 11: API Calls + Referrers — side by side */
      renderApiUsage(d), renderReferrers(d)
    ].join('');
    bindTableSort(); bindSearch(); bindExport();
    if (firstLoad) {
      fadeInElements('.kpi-card', 100); fadeInElements('.card', 300); firstLoad = false;
      setTimeout(function() { $$('.kpi-value[data-target]').forEach(function(el) { animateValue(el, el.dataset.target, 800); }); }, 200);
    } else {
      $$('.kpi-card').forEach(function(el) { el.classList.add('visible'); });
      $$('.card').forEach(function(el) { el.classList.add('visible'); });
    }
  }

  // ==================== RENDERERS ====================
  function renderAlertBanner(u) {
    var banner = $('#alertBanner');
    if (!u || !u.alerts || u.alerts.length === 0) { banner.classList.remove('active'); return; }
    var latest = u.alerts[u.alerts.length - 1];
    banner.textContent = latest.message;
    banner.className = 'alert-banner active ' + (latest.level === 'critical' ? '' : 'warning');
    if (latest.level === 'critical') { banner.classList.add('shake'); playAlert(); setTimeout(function() { banner.classList.remove('shake'); }, 600); }
  }

  function renderKPIs(d, w, e, an) {
    var convRate = d.pageVisits.waitlist > 0 ? Math.round(w.total / d.pageVisits.waitlist * 100) : 0;
    var totalVisits = (d.pageVisits.waitlist || 0) + (d.pageVisits.library || 0) + (d.pageVisits.tomes || 0);
    var liveCount = an ? (an.liveVisitors || 0) : 0;
    function kz(v) { return (v === 0 || v === '0%') ? ' zero' : ''; }
    $('#kpiRow').innerHTML = ''
      + '<div class="kpi-card' + (liveCount > 0 ? ' live-pulse' : '') + '"><div class="kpi-value' + (liveCount > 0 ? ' accent' : kz(liveCount)) + '" data-target="' + liveCount + '">0</div><div class="kpi-label">' + (liveCount > 0 ? '<span class="pulse"></span>' : '') + 'Live Now</div></div>'
      + '<div class="kpi-card"><div class="kpi-value' + kz(totalVisits) + '" data-target="' + totalVisits + '">0</div><div class="kpi-label">Total Visits</div></div>'
      + '<div class="kpi-card"><div class="kpi-value' + kz(d.uniqueVisitors) + '" data-target="' + d.uniqueVisitors + '">0</div><div class="kpi-label">Unique Visitors</div></div>'
      + '<div class="kpi-card"><div class="kpi-value' + kz(w.total) + '" data-target="' + w.total + '">0</div><div class="kpi-label">Signups</div></div>'
      + '<div class="kpi-card"><div class="kpi-value' + kz(e.completed) + '" data-target="' + e.completed + '">0</div><div class="kpi-label">Ebooks</div></div>'
      + '<div class="kpi-card"><div class="kpi-value accent' + kz(convRate + '%') + '" data-target="' + convRate + '%">0%</div><div class="kpi-label">Conversion</div></div>';
  }

  function renderTraffic(d, an) {
    var sources = an ? an.trafficSources : (d.trafficSources || {}); var srcTotal = 0;
    for (var k in sources) srcTotal += sources[k]; if (!srcTotal) srcTotal = 1;
    var srcBars = Object.entries(sources).filter(function(e){ return e[1] > 0; }).sort(function(a,b){ return b[1]-a[1]; }).map(function(e) {
      return '<div class="bar-item"><div class="bar-label">' + e[0] + '</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round(e[1]/srcTotal*100) + '%"></div></div><div class="bar-count">' + e[1] + ' (' + Math.round(e[1]/srcTotal*100) + '%)</div></div>';
    }).join('');
    var br = an ? an.bounceRate : 0, nv = an ? an.newVisitors : 0, rv = an ? an.returningVisitors : 0, dt = d.devices.tablet || 0;
    function zc(v) { return v === 0 ? ' zero' : ''; }
    return '<div class="card"><div class="card-title"><span class="pulse"></span>Traffic & Visitors</div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value'+zc(d.pageVisits.waitlist)+'">' + d.pageVisits.waitlist + '</div><div class="stat-label">Waitlist visits</div></div><div class="stat"><div class="stat-value'+zc(d.pageVisits.library)+'">' + d.pageVisits.library + '</div><div class="stat-label">Library visits</div></div><div class="stat"><div class="stat-value'+zc(d.pageVisits.tomes||0)+'">' + (d.pageVisits.tomes||0) + '</div><div class="stat-label">Tomes visits</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small'+zc(d.devices.desktop)+'">' + d.devices.desktop + '</div><div class="stat-label">Desktop</div></div><div class="stat"><div class="stat-value small'+zc(d.devices.mobile)+'">' + d.devices.mobile + '</div><div class="stat-label">Mobile</div></div><div class="stat"><div class="stat-value small'+zc(dt)+'">' + dt + '</div><div class="stat-label">Tablet</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small'+zc(nv)+'">' + nv + '</div><div class="stat-label">New visitors</div></div><div class="stat"><div class="stat-value small'+zc(rv)+'">' + rv + '</div><div class="stat-label">Returning</div></div><div class="stat"><div class="stat-value small'+zc(br)+'">' + br + '%</div><div class="stat-label">Bounce rate</div></div></div>'
      + (srcBars ? '<div class="section-label" style="margin-top:16px">Traffic Sources</div><div class="bar-group">' + srcBars + '</div>' : '') + '</div>';
  }

  function renderVisitorFeed(d) {
    var visitors = d.recentVisitors || [], cs = {}, vm = d.visitors || {};
    for (var ip in vm) { var vv = vm[ip], cc = vv.country||'Unknown'; if (!cs[cc]) cs[cc]={count:0}; cs[cc].count++; }
    var tc = Object.entries(cs).sort(function(a,b){ return b[1].count-a[1].count; }).slice(0,10);
    var mc = tc.length > 0 ? tc[0][1].count : 1;
    var cb = '';
    if (tc.length > 0 && !(tc.length === 1 && tc[0][0] === 'Unknown')) {
      cb = '<div style="margin-bottom:20px"><div class="section-label">Visitors by Country</div>' + tc.filter(function(e){ return e[0]!=='Unknown'; }).map(function(e) {
        return '<div class="bar-item"><div class="bar-label" style="min-width:60px">' + countryFlag(e[0]) + ' ' + e[0] + '</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round(e[1].count/mc*100) + '%"></div></div><div class="bar-count">' + e[1].count + '</div></div>';
      }).join('') + '</div>';
    }
    var now = Date.now();
    var fi = visitors.slice(0,30).map(function(v) {
      var ago = now - new Date(v.timestamp).getTime(), ir = ago < 300000;
      var ta = ago < 60000 ? 'just now' : ago < 3600000 ? Math.floor(ago/60000)+'m ago' : ago < 86400000 ? Math.floor(ago/3600000)+'h ago' : Math.floor(ago/86400000)+'d ago';
      var geo = [v.city,v.region,v.country].filter(Boolean).join(', ') || v.ip;
      return '<div class="visitor-item"><div class="visitor-dot'+(ir?' recent':'')+'"></div><div class="visitor-page">'+escHtml(v.page)+'</div><div class="visitor-geo">'+(v.country?countryFlag(v.country)+' ':'')+escHtml(geo)+'</div><div class="visitor-device">'+(v.isMobile?'Mobile':'Desktop')+'</div><div class="visitor-time">'+ta+'</div></div>';
    }).join('');
    return '<div class="card"><div class="card-title"><span class="pulse"></span>Live Visitors</div>' + cb + '<div class="section-label">Recent Activity</div><div class="visitor-feed">' + (fi || '<div class="empty-state">Visitor activity appears here in real time as seekers arrive.</div>') + '</div></div>';
  }

  function renderWaitlistOverview(w, d) {
    var cr = d.pageVisits.waitlist > 0 ? Math.round(w.total / d.pageVisits.waitlist * 100) : 0;
    var sr = w.surveyStats.completionRate, trend = w.signupTrend || [], th = '';
    if (trend.length > 0) {
      var hasData = trend.some(function(t){ return t.count > 0; });
      if (hasData) {
        var mt = Math.max.apply(null, trend.map(function(t){ return t.count; })) || 1;
        th = '<div style="margin-top:16px"><div class="section-label">Last 30 Days</div><div style="display:flex;align-items:flex-end;gap:2px;height:60px">' + trend.map(function(t) {
          var h = Math.max(2, Math.round(t.count / mt * 56));
          return '<div title="'+t.date+': '+t.count+'" style="flex:1;height:'+h+'px;background:linear-gradient(0deg,#3a3528,#5a5038);border-radius:2px 2px 0 0;min-width:3px"></div>';
        }).join('') + '</div></div>';
      }
    }
    var fn = analyticsData ? analyticsData.funnel : null, fh = '';
    if (fn) {
      var steps = [{label:'Page View',value:fn.pageView||0},{label:'Email Submit',value:fn.emailSubmit||0},{label:'Survey Done',value:fn.surveyComplete||0}];
      var fm = Math.max.apply(null, steps.map(function(s){ return s.value; })) || 1;
      fh = '<div style="margin-top:20px"><div class="section-label">Conversion Funnel</div><div class="funnel-group">' + steps.map(function(s,i) {
        var pct = fm > 0 ? Math.round(s.value/fm*100) : 0;
        var dropoff = i > 0 && steps[i-1].value > 0 ? ' (' + Math.round(s.value/steps[i-1].value*100) + '%)' : '';
        return '<div class="bar-item"><div class="bar-label">'+s.label+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div><div class="bar-count">'+s.value+dropoff+'</div></div>';
      }).join('') + '</div></div>';
    }
    function zc(v) { return v === 0 || v === '0' ? ' zero' : ''; }
    return '<div class="card"><div class="card-title">Waitlist & Signups</div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value'+zc(w.total)+'">'+w.total+'</div><div class="stat-label">Total signups</div></div><div class="stat"><div class="stat-value accent'+zc(w.rate.today)+'">'+w.rate.today+'</div><div class="stat-label">Today</div></div><div class="stat"><div class="stat-value accent'+zc(w.rate.thisWeek)+'">'+w.rate.thisWeek+'</div><div class="stat-label">This week</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small'+zc(cr)+'">'+cr+'%</div><div class="stat-label">Visit-to-signup</div></div><div class="stat"><div class="stat-value small'+zc(parseInt(sr))+'">'+sr+'%</div><div class="stat-label">Survey completion</div></div><div class="stat"><div class="stat-value small'+zc(w.surveyStats.completed)+'">'+w.surveyStats.completed+'</div><div class="stat-label">Surveys done</div></div></div>'
      + th + fh + '</div>';
  }

  function renderSurveyInsights(w) {
    var s = w.surveyStats, topics = s.topTopics || [], mtc = topics.length > 0 ? topics[0][1] : 1;
    var tb = topics.slice(0,10).map(function(t) { return '<div class="bar-item"><div class="bar-label" style="min-width:120px">'+t[0]+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(t[1]/mtc*100)+'%"></div></div><div class="bar-count">'+t[1]+'</div></div>'; }).join('');
    function mb(entries) {
      if (!entries || !entries.length) return '';
      var mx = Math.max.apply(null, entries.map(function(e){ return e[1]; })) || 1;
      return entries.map(function(e) { return '<div class="bar-item"><div class="bar-label">'+e[0]+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(e[1]/mx*100)+'%"></div></div><div class="bar-count">'+e[1]+'</div></div>'; }).join('');
    }
    var pe = Object.entries(s.wouldPay||{}), fe = Object.entries(s.formats||{}), re = Object.entries(s.roles||{}), se = Object.entries(s.sources||{});
    var hd = topics.length > 0 || pe.length > 0 || fe.length > 0 || re.length > 0 || se.length > 0;
    function emptySection(label) { return '<div><div class="section-label">'+label+'</div><div style="color:#2a2520;font-size:13px;font-style:italic;padding:8px 0">---</div></div>'; }
    return '<div class="card card-full"><div class="card-title">Survey Insights</div>'
      + (!hd ? '<div class="empty-state" style="margin-bottom:20px">Survey responses appear here as seekers complete the waitlist form.</div>' : '')
      + (topics.length > 0 ? '<div style="margin-bottom:20px"><div class="section-label">Top Topics</div><div class="bar-group">'+tb+'</div></div>' : (!hd ? '<div style="margin-bottom:20px"><div class="section-label">Top Topics</div><div style="color:#2a2520;font-size:13px;font-style:italic;padding:8px 0">---</div></div>' : ''))
      + '<div class="survey-grid">'
      + (re.length > 0 ? '<div><div class="section-label">Seeker Role</div><div class="bar-group">'+mb(re)+'</div></div>' : (!hd ? emptySection('Seeker Role') : ''))
      + (fe.length > 0 ? '<div><div class="section-label">Preferred Format</div><div class="bar-group">'+mb(fe)+'</div></div>' : (!hd ? emptySection('Preferred Format') : ''))
      + (pe.length > 0 ? '<div><div class="section-label">Would Pay?</div><div class="bar-group">'+mb(pe)+'</div></div>' : (!hd ? emptySection('Would Pay?') : ''))
      + (se.length > 0 ? '<div><div class="section-label">Discovery Source</div><div class="bar-group">'+mb(se)+'</div></div>' : (!hd ? emptySection('Discovery Source') : ''))
      + '</div></div>';
  }

  function renderEbookOverview(e) {
    function zc(v) { return v === 0 || v === '0' ? ' zero' : ''; }
    return '<div class="card"><div class="card-title">Ebook Generation</div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value'+zc(e.completed)+'">'+e.completed+'</div><div class="stat-label">Completed</div></div><div class="stat"><div class="stat-value'+(e.active>0?' accent':zc(e.active))+'">'+e.active+'</div><div class="stat-label">'+(e.active>0?'<span class="pulse warn"></span>':'')+'In progress</div></div><div class="stat"><div class="stat-value'+(e.failed>0?' danger':' zero')+'">'+e.failed+'</div><div class="stat-label">Failed</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small'+(e.avgDurationSeconds===0?' zero':'')+'">'+e.avgDurationSeconds+'s</div><div class="stat-label">Avg generation time</div></div><div class="stat"><div class="stat-value small'+(e.total===0?' zero':'')+'">'+e.successRate+'%</div><div class="stat-label">Success rate</div></div><div class="stat"><div class="stat-value small'+zc(e.total)+'">'+e.total+'</div><div class="stat-label">Total attempts</div></div></div></div>';
  }

  function renderCoverStats(d) {
    var c = d.covers, t = c.geminiSuccess + c.imagenFallback + c.failed;
    if (t === 0) return '<div class="card"><div class="card-title">Cover Generation</div><div class="empty-state">Cover stats appear here after the first ebook generation.</div></div>';
    return '<div class="card"><div class="card-title">Cover Generation</div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value success small">'+c.geminiSuccess+'</div><div class="stat-label">Gemini (direct)</div></div><div class="stat"><div class="stat-value accent small">'+c.imagenFallback+'</div><div class="stat-label">Imagen fallback</div></div><div class="stat"><div class="stat-value danger small">'+c.failed+'</div><div class="stat-label">Failed</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small">'+Math.round(c.imagenFallback/t*100)+'%</div><div class="stat-label">Fallback rate</div></div><div class="stat"><div class="stat-value small">'+Math.round(c.failed/t*100)+'%</div><div class="stat-label">Failure rate</div></div></div></div>';
  }

  function renderAccountsOverview(a) {
    if (!a || !a.accounts) return '<div class="card"><div class="card-title">Accounts</div><div class="empty-state">No accounts created yet. User data appears here after the first sign-in.</div></div>';
    var mem = a.accounts.filter(function(x){ return x.membershipStatus==='member'; }).length;
    var wg = a.accounts.filter(function(x){ return x.providers && x.providers.indexOf('google')>=0; }).length;
    var wm = a.accounts.filter(function(x){ return x.providers && x.providers.indexOf('microsoft')>=0; }).length;
    var we = a.accounts.filter(function(x){ return x.providers && x.providers.indexOf('email')>=0; }).length;
    var ww = a.accounts.filter(function(x){ return x.waitlistLinked; }).length;
    var tt = a.accounts.reduce(function(s,x){ return s+(x.tomesCount||0); }, 0);
    var rows = a.accounts.slice(0,50).map(function(u) { return '<tr><td title="'+escHtml(u.email)+'">'+escHtml(u.email)+'</td><td>'+(u.providers||[]).join(', ')+'</td><td>'+(u.tomesCount||0)+'</td><td>'+(u.createdAt?new Date(u.createdAt).toLocaleDateString():'-')+'</td></tr>'; }).join('');
    return '<div class="card"><div class="card-title">Accounts ('+a.total+')</div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value'+(a.total===0?' zero':'')+'">'+a.total+'</div><div class="stat-label">Total</div></div><div class="stat"><div class="stat-value accent'+(mem===0?' zero':'')+'">'+mem+'</div><div class="stat-label">Members</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small'+(wg===0?' zero':'')+'">'+wg+'</div><div class="stat-label">Google</div></div><div class="stat"><div class="stat-value small'+(wm===0?' zero':'')+'">'+wm+'</div><div class="stat-label">Microsoft</div></div><div class="stat"><div class="stat-value small'+(we===0?' zero':'')+'">'+we+'</div><div class="stat-label">Email</div></div></div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value small'+(ww===0?' zero':'')+'">'+ww+'</div><div class="stat-label">Waitlist-linked</div></div><div class="stat"><div class="stat-value small'+(tt===0?' zero':'')+'">'+tt+'</div><div class="stat-label">Total tomes</div></div></div>'
      + (a.accounts.length > 0 ? '<div class="data-table-wrap"><table class="data-table" style="table-layout:fixed"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:15%"><col style="width:25%"></colgroup><thead><tr><th>Email</th><th>Provider</th><th>Tomes</th><th>Joined</th></tr></thead><tbody>'+rows+'</tbody></table></div>' : '<div class="empty-state">No accounts created yet. User data appears here after the first sign-in.</div>') + '</div>';
  }

  function renderProviders(d) {
    var p = d.providers || {};
    function pc(name, label, info) {
      if (!info) return '';
      var sc = info.active ? 'active-provider' : (info.configured ? '' : 'not-configured');
      var badge = info.active ? '<span class="provider-badge active">ACTIVE</span>' : info.configured ? '<span class="provider-badge configured">Ready</span>' : '<span class="provider-badge off">Not configured</span>';
      return '<div class="provider-card '+sc+'">'+badge+'<div class="provider-name">'+label+'</div><div class="provider-detail">Model: '+escHtml(info.model)+'</div><div class="provider-detail">Auth: '+info.auth+'</div>'+(info.budget?'<div class="provider-detail">Budget: '+info.budget+'</div>':'')+(info.limits?'<div class="provider-detail">'+(info.limits.rpm?info.limits.rpm+' RPM':'')+(info.limits.tpm?' / '+fmtNum(info.limits.tpm)+' TPM':'')+(info.limits.tpd?' / '+fmtNum(info.limits.tpd)+' TPD':'')+'</div>':'')+'</div>';
    }
    return '<div class="card card-full"><div class="card-title"><span class="pulse"></span>LLM Providers</div><div class="provider-grid">'+pc('gemini','Gemini',p.gemini)+pc('openai','OpenAI',p.openai)+pc('openrouter','OpenRouter',p.openrouter)+'</div></div>';
  }

  function renderLlmUsage(u, d) {
    if (!u) return '<div class="card card-full"><div class="card-title">API & Budget</div><div class="empty-state">Usage tracking data appears here once API calls are made.</div></div>';
    var today = u.today || {}, allTime = u.allTime || {}, todayBars = '';
    var pcs = { gemini:{label:'Gemini',tl:1000000}, openai:{label:'OpenAI',tl:2500000}, openrouter:{label:'OpenRouter',tl:null} };
    for (var prov in pcs) {
      var cfg = pcs[prov], usage = today[prov]; if (!usage && !allTime[prov]) continue;
      var calls = usage?usage.calls:0, tokens = usage?usage.tokens:0, errors = usage?usage.errors:0;
      var avgLat = usage&&usage.calls>0?Math.round(usage.latencyMs/usage.calls):0;
      var atC = allTime[prov]?allTime[prov].calls:0, atT = allTime[prov]?allTime[prov].tokens:0, atE = allTime[prov]?allTime[prov].errors:0;
      var tb = '';
      if (cfg.tl) { var pct = Math.min(100, Math.round(tokens/cfg.tl*100)); var bc = pct>90?'red':pct>70?'yellow':'green'; tb = '<div class="usage-bar-wrap"><div class="usage-bar-header"><span class="usage-bar-label">Tokens today</span><span class="usage-bar-value">'+fmtNum(tokens)+' / '+fmtNum(cfg.tl)+'</span></div><div class="usage-bar-track"><div class="usage-bar-fill '+bc+'" style="width:'+pct+'%"></div></div></div>'; }
      todayBars += '<div style="margin-bottom:16px"><div style="color:#8a7d55;font-size:13px;font-weight:bold;margin-bottom:8px">'+cfg.label+'</div><div class="stat-row" style="margin-bottom:8px"><div class="stat"><div class="stat-value small">'+calls+'</div><div class="stat-label">Calls today</div></div><div class="stat"><div class="stat-value small">'+fmtNum(tokens)+'</div><div class="stat-label">Tokens today</div></div><div class="stat"><div class="stat-value small'+(errors>0?' danger':'')+'">'+errors+'</div><div class="stat-label">Errors today</div></div><div class="stat"><div class="stat-value small">'+avgLat+'ms</div><div class="stat-label">Avg latency</div></div></div>'+tb+'<div style="font-size:11px;color:#3a3528;margin-top:4px">All time: '+fmtNum(atC)+' calls, '+fmtNum(atT)+' tokens, '+atE+' errors</div></div>';
    }
    var last7 = (u.last7Days||[]).slice().reverse(), ch = '';
    if (last7.length > 0) {
      var mx = 1; last7.forEach(function(dy) { var t = 0; for (var p in (dy.usage||{})) t += (dy.usage[p].calls||0); if (t>mx) mx=t; });
      ch = '<div style="margin-top:16px"><div class="section-label">Last 7 Days (API Calls)</div>' + last7.map(function(day) { var t = 0; for (var p in (day.usage||{})) t += (day.usage[p].calls||0); return '<div class="bar-item"><div class="bar-label" style="min-width:50px">'+day.date.slice(5)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(t/mx*100)+'%"></div></div><div class="bar-count">'+t+'</div></div>'; }).join('') + '</div>';
    }
    var ah = '';
    if (u.alerts && u.alerts.length > 0) { ah = '<div style="margin-top:16px"><div class="section-label" style="color:#7a4a4a">Budget Alerts</div>' + u.alerts.slice(-5).reverse().map(function(a) { return '<div style="font-size:12px;color:'+(a.level==='critical'?'#9a5a5a':'#b8a86a')+';padding:4px 0;border-bottom:1px solid #0f0e0c">'+formatTime(a.timestamp)+' -- '+escHtml(a.message)+'</div>'; }).join('') + '</div>'; }
    return '<div class="card card-full"><div class="card-title">API & Budget</div>' + (todayBars || '<div class="empty-state">No LLM calls tracked yet.</div>') + ch + ah + '</div>';
  }

  function renderApiUsage(d) {
    var calls = d.apiCalls, total = 0, mx = 1;
    for (var k in calls) { total += calls[k]; if (calls[k] > mx) mx = calls[k]; }
    var bars = Object.entries(calls).sort(function(a,b){ return b[1]-a[1]; }).map(function(e) { return '<div class="bar-item"><div class="bar-label">'+e[0]+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(e[1]/mx*100)+'%"></div></div><div class="bar-count">'+e[1]+'</div></div>'; }).join('');
    return '<div class="card"><div class="card-title">API Calls</div><div class="stat-row"><div class="stat"><div class="stat-value">'+total+'</div><div class="stat-label">Total API calls</div></div></div><div class="bar-group">'+bars+'</div></div>';
  }

  function renderErrors(d, an) {
    var errors = d.errors, re = an ? (an.recentErrors||[]) : (errors.recent||[]);
    var er = re.slice(0,15).map(function(e) { return '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #0f0e0c;display:flex;gap:12px"><span style="color:'+(e.status>=500?'#9a5a5a':e.status===429?'#b8a86a':'#8a8070')+';min-width:32px">'+(e.status||'?')+'</span><span style="color:#5a5038;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(e.context||'')+'</span><span style="color:#3a3528;white-space:nowrap">'+formatTime(e.timestamp)+'</span></div>'; }).join('');
    return '<div class="card"><div class="card-title">Errors & Logs</div>'
      + '<div class="stat-row"><div class="stat"><div class="stat-value'+(errors.total>0?' danger':'')+' small">'+errors.total+'</div><div class="stat-label">Total errors</div></div><div class="stat"><div class="stat-value danger small">'+errors.e500+'</div><div class="stat-label">500s</div></div><div class="stat"><div class="stat-value danger small">'+errors.e429+'</div><div class="stat-label">429s</div></div><div class="stat"><div class="stat-value danger small">'+(errors.timeouts||0)+'</div><div class="stat-label">Timeouts</div></div></div>'
      + (er ? '<div style="margin-top:12px"><div class="section-label">Recent Errors</div>'+er+'</div>' : '') + '</div>';
  }

  function renderSystem(d) {
    var s = d.system, m = s.memoryMB;
    return '<div class="card"><div class="card-title"><span class="pulse"></span>System</div>'
      + '<div class="sys-row"><span class="sys-label">Uptime</span><span class="sys-value">'+s.uptimeHuman+'</span></div>'
      + '<div class="sys-row"><span class="sys-label">Active provider</span><span class="sys-value">'+s.activeProvider+'</span></div>'
      + '<div class="sys-row"><span class="sys-label">Active model</span><span class="sys-value">'+s.activeModel+'</span></div>'
      + '<div class="sys-row"><span class="sys-label">Active sessions</span><span class="sys-value">'+s.activeSessions+'</span></div>'
      + '<div class="sys-row"><span class="sys-label">Memory (RSS)</span><span class="sys-value">'+m.rss+' MB</span></div>'
      + '<div class="sys-row"><span class="sys-label">Heap</span><span class="sys-value">'+m.heapUsed+' / '+m.heapTotal+' MB</span></div>'
      + '<div class="sys-row"><span class="sys-label">Node</span><span class="sys-value">'+s.nodeVersion+'</span></div>'
      + '<div class="sys-row"><span class="sys-label">Platform</span><span class="sys-value">'+s.platform+'</span></div>'
      + '<div class="sys-row"><span class="sys-label">Started</span><span class="sys-value">'+formatTime(d.serverStartTime)+'</span></div></div>';
  }

  function renderWaitlistTable(w) {
    var signups = w.signups || [];
    if (!signups.length) return '<div class="card card-full"><div class="card-title">Waitlist Signups</div><div class="empty-state">No signups recorded yet. Waitlist data appears here as seekers join.</div></div>';
    var rows = signups.map(function(s) { return '<tr><td title="'+escHtml(s.email)+'">'+escHtml(s.email)+'</td><td>'+formatTime(s.timestamp)+'</td><td>'+(s.referrer?escHtml(tryHostname(s.referrer)):'--')+'</td><td>'+(s.hasSurvey?'<span class="tag tag-yes">yes</span>':'<span class="tag tag-no">no</span>')+'</td><td title="'+(s.survey?escHtml(s.survey.topics||''):'')+'">'+(s.survey?escHtml(s.survey.topics||'--'):'--')+'</td><td>'+(s.survey?escHtml(s.survey.format||'--'):'--')+'</td><td>'+(s.survey?escHtml(s.survey.role||'--'):'--')+'</td><td>'+(s.survey?escHtml(s.survey.wouldPay||'--'):'--')+'</td><td>'+(s.survey?escHtml(s.survey.source||'--'):'--')+'</td></tr>'; }).join('');
    return '<div class="card card-full"><div class="card-title">Waitlist Signups ('+signups.length+')<button class="btn-export" data-export="waitlist">Export JSON</button></div><input class="search-input" type="text" placeholder="Search emails..." data-search="waitlist-table"><div class="data-table-wrap"><table class="data-table" id="waitlist-table" style="table-layout:auto;min-width:900px"><thead><tr><th data-sort="0" style="min-width:180px">Email</th><th data-sort="1" style="min-width:110px">Date</th><th data-sort="2" style="min-width:100px">Referrer</th><th data-sort="3" style="min-width:70px">Survey</th><th data-sort="4" style="min-width:150px">Topics</th><th data-sort="5" style="min-width:90px">Format</th><th data-sort="6" style="min-width:90px">Role</th><th data-sort="7" style="min-width:90px">Would Pay</th><th data-sort="8" style="min-width:110px">Source</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  function renderEbookTable(e) {
    var jobs = e.jobs || [];
    if (!jobs.length) return '<div class="card card-full"><div class="card-title">Ebook History</div><div class="empty-state">Ebook history appears here after the first generation.</div></div>';
    var rows = jobs.map(function(j) { var sc = j.status==='ready'?'tag-ready':j.status==='generating'?'tag-generating':'tag-failed'; return '<tr><td title="'+escHtml(j.title||'')+'">'+escHtml(j.title||'--')+'</td><td><span class="tag '+sc+'">'+j.status+'</span></td><td>'+(j.chapters||'--')+'</td><td>'+(j.durationHuman||'--')+'</td><td>'+formatTime(j.generatedAt)+'</td><td title="'+(j.error?escHtml(j.error):'')+'">'+( j.error?escHtml(j.error):'--')+'</td></tr>'; }).join('');
    return '<div class="card card-full"><div class="card-title">Ebook History ('+jobs.length+')<button class="btn-export" data-export="ebooks">Export JSON</button></div><input class="search-input" type="text" placeholder="Search titles..." data-search="ebook-table"><div class="data-table-wrap"><table class="data-table" id="ebook-table" style="table-layout:fixed"><colgroup><col style="width:30%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:20%"><col style="width:20%"></colgroup><thead><tr><th data-sort="0">Title</th><th data-sort="1">Status</th><th data-sort="2">Chapters</th><th data-sort="3">Duration</th><th data-sort="4">Date</th><th data-sort="5">Error</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  function renderReferrers(d) {
    var refs = Object.entries(d.referrers||{}).sort(function(a,b){ return b[1]-a[1]; });
    if (!refs.length) return '<div class="card"><div class="card-title">Referrers</div><div class="empty-state">Referrer data appears here as visitors arrive from external sources.</div></div>';
    var mx = refs[0][1];
    var bars = refs.slice(0,15).map(function(e) { return '<div class="bar-item"><div class="bar-label" style="min-width:140px">'+escHtml(e[0])+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(e[1]/mx*100)+'%"></div></div><div class="bar-count">'+e[1]+'</div></div>'; }).join('');
    return '<div class="card"><div class="card-title">Referrers</div><div class="bar-group">'+bars+'</div></div>';
  }

  // ==================== HELPERS ====================
  function formatTime(iso) { if (!iso) return '--'; try { var d = new Date(iso); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}); } catch(e) { return iso; } }
  function escHtml(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function tryHostname(url) { try { return new URL(url).hostname; } catch(e) { return url; } }
  function fmtNum(n) { if (n >= 1000000) return (n/1000000).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(1)+'K'; return String(n); }
  function countryFlag(code) { if (!code || code.length !== 2) return ''; return String.fromCodePoint.apply(null, code.toUpperCase().split('').map(function(c){ return c.charCodeAt(0)+127397; })); }

  // ==================== TABLE INTERACTIONS ====================
  function bindTableSort() {
    $$('.data-table th[data-sort]').forEach(function(th) {
      th.addEventListener('click', function() {
        playClick(); var table = this.closest('table'), colIdx = parseInt(this.dataset.sort), tableId = table.id;
        var state = sortState[tableId] || { col: -1, asc: true };
        state.asc = state.col === colIdx ? !state.asc : true; state.col = colIdx; sortState[tableId] = state;
        var tbody = table.querySelector('tbody'), rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function(a,b) { var at = a.children[colIdx]?a.children[colIdx].textContent:'', bt = b.children[colIdx]?b.children[colIdx].textContent:''; return (state.asc?1:-1)*at.localeCompare(bt,undefined,{numeric:true}); });
        rows.forEach(function(r) { tbody.appendChild(r); });
      });
    });
  }
  function bindSearch() { $$('.search-input[data-search]').forEach(function(input) { input.addEventListener('input', function() { var tid = this.dataset.search, q = this.value.toLowerCase(); $$('#'+tid+' tbody tr').forEach(function(r) { r.style.display = r.textContent.toLowerCase().indexOf(q)>=0?'':'none'; }); }); }); }
  function bindExport() {
    $$('.btn-export[data-export]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        playClick(); var type = this.dataset.export, data, fn;
        if (type==='waitlist') { data=waitlistData; fn='waitlist-export.json'; } else if (type==='ebooks') { data=ebooksData; fn='ebooks-export.json'; } else { data=metricsData; fn='metrics-export.json'; }
        var blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = fn; a.click(); URL.revokeObjectURL(url);
      });
    });
  }

  // ==================== CHAT WIDGET ====================
  var chatOpen = false, chatHistory = [], chatSending = false;
  $('#chatTrigger').addEventListener('click', function() {
    chatOpen = !chatOpen; $('#chatPanel').classList.toggle('open', chatOpen); this.classList.toggle('open', chatOpen); playClick();
    if (chatOpen) setTimeout(function() { $('#chatInput').focus(); }, 100);
  });
  $('#chatSend').addEventListener('click', sendChatMessage);
  $('#chatInput').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });

  async function sendChatMessage() {
    if (chatSending) return;
    var input = $('#chatInput'), message = input.value.trim(); if (!message) return;
    playClick(); input.value = ''; chatSending = true; $('#chatSend').disabled = true;
    appendChatMsg(message, 'admin'); chatHistory.push({ role: 'user', content: message });
    var typingEl = appendChatMsg('Consulting the archives...', 'guardian typing');
    try {
      var res = await fetch('/api/admin/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message, history: chatHistory.slice(-20) }) });
      if (res.status === 403) { typingEl.textContent = 'Access denied.'; typingEl.classList.remove('typing'); chatSending = false; $('#chatSend').disabled = false; return; }
      var data = await res.json(); typingEl.remove();
      var reply = data.reply || 'The archives are silent.';
      appendChatMsg(reply, 'guardian'); chatHistory.push({ role: 'assistant', content: reply });
    } catch(e) { typingEl.textContent = 'The connection faltered.'; typingEl.classList.remove('typing'); }
    chatSending = false; $('#chatSend').disabled = false;
  }
  function appendChatMsg(text, cls) { var msgs = $('#chatMessages'), div = document.createElement('div'); div.className = 'chat-msg ' + cls; div.textContent = text; msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight; return div; }

  // ==================== INIT ====================
  fetchAll();
  setInterval(fetchAll, 30000);
})();
