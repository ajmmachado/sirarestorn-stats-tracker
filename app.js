/* ===========================================================
   Torn Pro Stats Tracker — 4M Goal System
   Vanilla JS, no dependencies. Single personal device app.
   =========================================================== */
(() => {
  "use strict";

  const GOAL = 4_000_000;

  // ---------- storage keys ----------
  const K = {
    pwHash: "tps_pw_hash",
    pwSalt: "tps_pw_salt",
    failed: "tps_failed_attempts",
    lockUntil: "tps_lock_until",
    apiKey: "tps_api_key",
    snapshots: "tps_snapshots",
  };

  // ---------- DOM shortcuts ----------
  const $ = (id) => document.getElementById(id);
  const screens = {
    setupPassword: $("screen-setup-password"),
    lock: $("screen-lock"),
    apiSetup: $("screen-api-setup"),
    app: $("screen-app"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => (s.hidden = true));
    screens[name].hidden = false;
  }

  function toast(msg, ms = 2400) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add("is-visible"));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      t.classList.remove("is-visible");
      setTimeout(() => (t.hidden = true), 250);
    }, ms);
  }

  const fmt = (n) =>
    Math.round(n).toLocaleString("pt-PT").replace(/\u00A0/g, " ");

  const fmtSigned = (n) => (n > 0 ? "+" : "") + fmt(n);

  // ===========================================================
  // Crypto helpers — local password protection
  // ===========================================================
  function bytesToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToHex(digest);
  }

  function randomSaltHex() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return bytesToHex(arr);
  }

  async function setNewPassword(password) {
    const salt = randomSaltHex();
    const hash = await sha256Hex(salt + password);
    localStorage.setItem(K.pwSalt, salt);
    localStorage.setItem(K.pwHash, hash);
  }

  async function verifyPassword(password) {
    const salt = localStorage.getItem(K.pwSalt) || "";
    const hash = localStorage.getItem(K.pwHash) || "";
    const attempt = await sha256Hex(salt + password);
    return attempt === hash;
  }

  // ===========================================================
  // Auth gate: password setup / lock / lockout
  // ===========================================================
  function hasPassword() {
    return !!localStorage.getItem(K.pwHash);
  }

  function isSessionUnlocked() {
    return sessionStorage.getItem("tps_unlocked") === "1";
  }

  function markUnlocked() {
    sessionStorage.setItem("tps_unlocked", "1");
  }

  function getLockRemainingMs() {
    const until = parseInt(localStorage.getItem(K.lockUntil) || "0", 10);
    return Math.max(0, until - Date.now());
  }

  function initLockScreenState() {
    const remaining = getLockRemainingMs();
    if (remaining > 0) {
      $("lock-error").hidden = false;
      $("lock-error").textContent = `Acesso bloqueado temporariamente. Tenta novamente em ${Math.ceil(
        remaining / 60000
      )} min.`;
      $("lock-submit").disabled = true;
      setTimeout(initLockScreenState, 5000);
    } else {
      $("lock-submit").disabled = false;
    }
    const failed = parseInt(localStorage.getItem(K.failed) || "0", 10);
    if (failed > 0 && remaining === 0) {
      $("lock-attempts").hidden = false;
      $("lock-attempts").textContent = `Tentativas falhadas: ${failed}/5`;
    }
  }

  $("setup-submit").addEventListener("click", async () => {
    const p1 = $("setup-pass").value;
    const p2 = $("setup-pass-confirm").value;
    const err = $("setup-error");
    err.hidden = true;

    if (p1.length < 4) {
      err.textContent = "A password deve ter pelo menos 4 caracteres.";
      err.hidden = false;
      return;
    }
    if (p1 !== p2) {
      err.textContent = "As passwords não coincidem.";
      err.hidden = false;
      return;
    }
    await setNewPassword(p1);
    markUnlocked();
    toast("Acesso configurado.");
    routeToNextScreen();
  });

  $("lock-submit").addEventListener("click", async () => {
    if (getLockRemainingMs() > 0) return;
    const pass = $("lock-pass").value;
    const ok = await verifyPassword(pass);
    const err = $("lock-error");
    if (ok) {
      localStorage.setItem(K.failed, "0");
      localStorage.removeItem(K.lockUntil);
      markUnlocked();
      err.hidden = true;
      $("lock-pass").value = "";
      routeToNextScreen();
    } else {
      const failed = parseInt(localStorage.getItem(K.failed) || "0", 10) + 1;
      localStorage.setItem(K.failed, String(failed));
      if (failed >= 5) {
        const lockUntil = Date.now() + 5 * 60 * 1000;
        localStorage.setItem(K.lockUntil, String(lockUntil));
        err.textContent = "Demasiadas tentativas. Bloqueado por 5 minutos.";
        $("lock-submit").disabled = true;
        setTimeout(initLockScreenState, 5000);
      } else {
        err.textContent = "Password incorreta.";
        $("lock-attempts").hidden = false;
        $("lock-attempts").textContent = `Tentativas falhadas: ${failed}/5`;
      }
      err.hidden = false;
    }
  });

  $("lock-reset").addEventListener("click", () => {
    const sure = confirm(
      "Isto apaga a password, a API key e todo o histórico guardado neste dispositivo. Continuar?"
    );
    if (!sure) return;
    localStorage.clear();
    sessionStorage.clear();
    location.reload();
  });

  // ===========================================================
  // Torn API integration
  // ===========================================================
  const API_SELECTIONS = "profile,bars,battlestats";

  async function fetchTornData(key) {
    const url = `https://api.torn.com/user/?selections=${API_SELECTIONS}&key=${encodeURIComponent(
      key
    )}&comment=4MGoalTracker`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Falha de rede ao contactar a Torn API.");
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error || "Erro desconhecido da Torn API.");
    }
    return json;
  }

  $("api-submit").addEventListener("click", async () => {
    const key = $("api-key-input").value.trim();
    const err = $("api-error");
    const status = $("api-status");
    err.hidden = true;
    status.hidden = true;

    if (!key) {
      err.textContent = "Introduz a tua API key do Torn.";
      err.hidden = false;
      return;
    }

    $("api-submit").disabled = true;
    $("api-submit-label").textContent = "A validar…";
    $("api-submit-spinner").hidden = false;

    try {
      const data = await fetchTornData(key);
      localStorage.setItem(K.apiKey, key);
      status.textContent = `Key validada — ligado como ${data.name || "jogador"}.`;
      status.hidden = false;
      toast("API key validada com sucesso.");
      setTimeout(() => {
        showScreen("app");
        loadAndRender(data);
      }, 500);
    } catch (e) {
      err.textContent =
        "Não foi possível validar a key: " + (e.message || "erro desconhecido.");
      err.hidden = false;
    } finally {
      $("api-submit").disabled = false;
      $("api-submit-label").textContent = "Validar e ligar";
      $("api-submit-spinner").hidden = true;
    }
  });

  // ===========================================================
  // Snapshots (local history)
  // ===========================================================
  function loadSnapshots() {
    try {
      return JSON.parse(localStorage.getItem(K.snapshots) || "[]");
    } catch {
      return [];
    }
  }

  function saveSnapshots(list) {
    localStorage.setItem(K.snapshots, JSON.stringify(list));
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }

  function buildSnapshotFromData(data) {
    const bs = data.battlestats || data;
    const str = bs.strength ?? 0;
    const def = bs.defense ?? 0;
    const spd = bs.speed ?? 0;
    const dex = bs.dexterity ?? 0;
    const total = str + def + spd + dex;
    const energy = data.energy || {};
    return {
      date: todayKey(),
      timestamp: Date.now(),
      str,
      def,
      spd,
      dex,
      total,
      energy: energy.current ?? null,
      energyMax: energy.maximum ?? null,
    };
  }

  function addAutoSnapshotIfNeeded(snapshot) {
    const list = loadSnapshots();
    const idx = list.findIndex((s) => s.date === snapshot.date);
    if (idx === -1) {
      list.push(snapshot);
    } else if (snapshot.total >= list[idx].total) {
      // keep the latest/highest reading of the day
      list[idx] = snapshot;
    }
    list.sort((a, b) => a.timestamp - b.timestamp);
    saveSnapshots(list);
    return list;
  }

  function addManualSnapshot(snapshot) {
    const list = loadSnapshots();
    list.push({ ...snapshot, manual: true });
    list.sort((a, b) => a.timestamp - b.timestamp);
    saveSnapshots(list);
    return list;
  }

  // Collapse to one (highest) reading per calendar date, ascending.
  function getDailySeries(snapshots) {
    const byDate = new Map();
    for (const s of snapshots) {
      const existing = byDate.get(s.date);
      if (!existing || s.total > existing.total) byDate.set(s.date, s);
    }
    return Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  // ===========================================================
  // Analytics: cycle detection, efficiency, ETA, insights, planner
  // ===========================================================
  function computeAnalytics(snapshots) {
    const daily = getDailySeries(snapshots);
    const deltas = [];
    for (let i = 1; i < daily.length; i++) {
      deltas.push({
        date: daily[i].date,
        total: daily[i].total,
        delta: daily[i].total - daily[i - 1].total,
      });
    }

    const deltaValues = deltas.map((d) => d.delta);
    const mean =
      deltaValues.length > 0
        ? deltaValues.reduce((a, b) => a + b, 0) / deltaValues.length
        : 0;
    const variance =
      deltaValues.length > 1
        ? deltaValues.reduce((a, b) => a + (b - mean) ** 2, 0) /
          deltaValues.length
        : 0;
    const std = Math.sqrt(variance);

    const burstThreshold = mean + std;
    const cooldownThreshold = Math.max(0, mean - std);

    const classified = deltas.map((d) => {
      let phase;
      if (deltaValues.length < 3) {
        phase = d.delta > 0 ? "normal" : "cooldown";
      } else if (d.delta >= burstThreshold && d.delta > mean) {
        phase = "burst";
      } else if (d.delta <= cooldownThreshold) {
        phase = "cooldown";
      } else {
        phase = "normal";
      }
      return { ...d, phase };
    });

    const normalDeltas = classified
      .filter((d) => d.phase === "normal")
      .map((d) => d.delta);
    const burstDeltas = classified
      .filter((d) => d.phase === "burst")
      .map((d) => d.delta);
    const cooldownCount = classified.filter((d) => d.phase === "cooldown")
      .length;

    const avg = (arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const normalRate = avg(normalDeltas);
    const burstRate = avg(burstDeltas);

    const consistency =
      mean > 0 ? Math.max(0, Math.min(1, 1 - std / mean)) : 0;

    const last7 = classified.slice(-7).map((d) => d.delta);
    const rate7d = avg(last7);
    const rateAll = mean;

    const currentTotal = daily.length ? daily[daily.length - 1].total : 0;
    const remaining = Math.max(0, GOAL - currentTotal);
    const etaDays = rateAll > 0 ? remaining / rateAll : null;
    const etaDate = etaDays
      ? new Date(Date.now() + etaDays * 86400000)
      : null;

    const currentPhase =
      classified.length > 0 ? classified[classified.length - 1].phase : "unknown";

    let paceState = "indeterminado";
    if (rateAll > 0 && last7.length > 0) {
      if (rate7d > rateAll * 1.1) paceState = "acima";
      else if (rate7d < rateAll * 0.9) paceState = "abaixo";
      else paceState = "no-ritmo";
    }

    // weekday pattern for planner (0=Mon ... 6=Sun)
    const weekdayBuckets = Array.from({ length: 7 }, () => []);
    classified.forEach((d) => {
      const jsDay = new Date(d.date + "T12:00:00").getDay(); // 0=Sun..6=Sat
      const mondayIndex = (jsDay + 6) % 7; // 0=Mon..6=Sun
      weekdayBuckets[mondayIndex].push(d.delta);
    });
    const weekdayPattern = weekdayBuckets.map((arr) => {
      if (arr.length === 0) return { avg: null, phase: "unknown", n: 0 };
      const a = avg(arr);
      let phase;
      if (deltaValues.length < 3) phase = a > 0 ? "normal" : "cooldown";
      else if (a >= burstThreshold && a > mean) phase = "burst";
      else if (a <= cooldownThreshold) phase = "cooldown";
      else phase = "normal";
      return { avg: a, phase, n: arr.length };
    });

    return {
      daily,
      classified,
      mean,
      std,
      normalRate,
      burstRate,
      cooldownCount,
      consistency,
      rate7d,
      rateAll,
      currentTotal,
      remaining,
      etaDays,
      etaDate,
      currentPhase,
      paceState,
      weekdayPattern,
      hasEnoughData: classified.length >= 2,
    };
  }

  function buildInsights(a, latestData) {
    const items = [];

    if (latestData && latestData.battlestats === undefined && latestData.strength === undefined) {
      items.push({
        type: "bad",
        text:
          "A API key não devolveu battlestats. Confirma que a key tem nível de acesso suficiente para ver Strength/Defense/Speed/Dexterity.",
      });
    }

    if (!a.hasEnoughData) {
      items.push({
        type: "info",
        text:
          "Ainda não há histórico suficiente para análise de ciclos e ritmo. Volta amanhã para o primeiro insight de progressão.",
      });
      return items;
    }

    if (a.paceState === "acima") {
      items.push({
        type: "good",
        text: `Estás acima do teu ritmo médio (últimos 7 dias: ${fmtSigned(
          a.rate7d
        )}/dia vs. média de ${fmtSigned(a.rateAll)}/dia). Mantém o padrão atual.`,
      });
    } else if (a.paceState === "abaixo") {
      items.push({
        type: "warn",
        text: `Estás abaixo do teu ritmo médio (últimos 7 dias: ${fmtSigned(
          a.rate7d
        )}/dia vs. média de ${fmtSigned(a.rateAll)}/dia). Considera intensificar treino ou iniciar um burst.`,
      });
    } else if (a.paceState === "no-ritmo") {
      items.push({
        type: "info",
        text: "Estás a manter o ritmo médio histórico. Progressão estável.",
      });
    }

    const phaseActionMap = {
      normal: "Próxima ação: continua o treino constante — não há sinal de burst nem de cooldown.",
      burst:
        "Próxima ação: estás em burst — aproveita o pico atual e planeia um período de cooldown a seguir.",
      cooldown:
        "Próxima ação: estás em cooldown — considera um ciclo de Xanax / Happy Jumps para reativar o crescimento.",
      unknown: "Próxima ação: continua a recolher dados para classificação de fase.",
    };
    items.push({ type: "info", text: phaseActionMap[a.currentPhase] });

    const lastN = a.classified.slice(-5);
    const cooldownStreak = lastN.filter((d) => d.phase === "cooldown").length;
    if (cooldownStreak >= 3) {
      items.push({
        type: "bad",
        text: `Alerta de ineficiência: ${cooldownStreak} dos últimos ${lastN.length} dias foram cooldown. O ritmo de progressão está a abrandar de forma consistente.`,
      });
    }

    if (a.etaDays !== null) {
      items.push({
        type: "info",
        text: `À taxa atual, faltam aproximadamente ${Math.ceil(
          a.etaDays
        )} dias (${a.etaDate.toLocaleDateString("pt-PT")}) para atingires 4.000.000.`,
      });
    }

    return items;
  }

  // ===========================================================
  // Rendering
  // ===========================================================
  function setPhaseTag(el, phase) {
    el.classList.remove("phase-normal", "phase-burst", "phase-cooldown", "phase-unknown");
    const map = {
      normal: ["phase-normal", "Normal"],
      burst: ["phase-burst", "Burst"],
      cooldown: ["phase-cooldown", "Cooldown"],
      unknown: ["phase-unknown", "—"],
    };
    const [cls, label] = map[phase] || map.unknown;
    el.classList.add(cls);
    el.textContent = label;
  }

  function renderTopbar(data) {
    $("player-name").textContent = data.name || "Jogador";
    const state = (data.status && data.status.state) || "";
    const pill = $("player-status");
    pill.classList.remove(
      "status-ok",
      "status-hospital",
      "status-abroad",
      "status-other"
    );
    let cls = "status-other";
    if (/hospital|jail|federal/i.test(state)) cls = "status-hospital";
    else if (/abroad|travel/i.test(state)) cls = "status-abroad";
    else if (/okay/i.test(state)) cls = "status-ok";
    pill.classList.add(cls);
    pill.textContent = state || "—";

    const e = data.energy || {};
    $("energy-readout").textContent = `EN ${e.current ?? "—"}/${e.maximum ?? "—"}`;
    $("last-sync").textContent = `Sincronizado às ${new Date().toLocaleTimeString(
      "pt-PT",
      { hour: "2-digit", minute: "2-digit" }
    )}`;
  }

  function renderRing(a) {
    const pct = Math.max(0, Math.min(100, (a.currentTotal / GOAL) * 100));
    const circumference = 603.19;
    const offset = circumference * (1 - pct / 100);
    const ring = $("ring-progress");
    ring.style.strokeDashoffset = String(offset);

    const colorMap = {
      normal: "var(--accent)",
      burst: "var(--amber)",
      cooldown: "var(--red)",
      unknown: "var(--accent)",
    };
    ring.style.stroke = colorMap[a.currentPhase] || "var(--accent)";

    $("ring-total").textContent = fmt(a.currentTotal);
    $("ring-percent").textContent = pct.toFixed(2) + "%";

    // ticks (drawn once)
    const ticksG = $("ring-ticks");
    if (!ticksG.dataset.drawn) {
      const cx = 110,
        cy = 110,
        r1 = 84,
        r2 = 90;
      let svg = "";
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + r1 * Math.cos(angle);
        const y1 = cy + r1 * Math.sin(angle);
        const x2 = cx + r2 * Math.cos(angle);
        const y2 = cy + r2 * Math.sin(angle);
        svg += `<line class="ring-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(
          1
        )}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"></line>`;
      }
      ticksG.innerHTML = svg;
      ticksG.dataset.drawn = "1";
    }
  }

  function renderStatGrid(data) {
    const bs = data.battlestats || data;
    $("stat-str").textContent = bs.strength != null ? fmt(bs.strength) : "—";
    $("stat-def").textContent = bs.defense != null ? fmt(bs.defense) : "—";
    $("stat-spd").textContent = bs.speed != null ? fmt(bs.speed) : "—";
    $("stat-dex").textContent = bs.dexterity != null ? fmt(bs.dexterity) : "—";
  }

  function renderKpis(a) {
    $("kpi-daily-rate").textContent = a.hasEnoughData
      ? fmtSigned(Math.round(a.rateAll)) + "/dia"
      : "—";
    setPhaseTag($("kpi-phase"), a.hasEnoughData ? a.currentPhase : "unknown");
    $("kpi-efficiency").textContent = a.hasEnoughData
      ? Math.round(a.consistency * 100) + "%"
      : "—";
  }

  function renderInsights(a, data) {
    const items = buildInsights(a, data);
    const wrap = $("insights-list");
    if (items.length === 0) {
      wrap.innerHTML =
        '<p class="empty-hint">Sem insights de momento.</p>';
      return;
    }
    wrap.innerHTML = items
      .map(
        (it) =>
          `<div class="insight-item insight-${it.type}"><span class="dot"></span><span>${it.text}</span></div>`
      )
      .join("");
  }

  function renderMiniChart(a) {
    const points = a.daily.slice(-14);
    const svg = $("mini-chart");
    const empty = $("mini-chart-empty");
    if (points.length < 2) {
      svg.innerHTML = "";
      empty.hidden = false;
      svg.style.display = "none";
      return;
    }
    empty.hidden = true;
    svg.style.display = "block";

    const totals = points.map((p) => p.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const range = max - min || 1;
    const w = 320,
      h = 110,
      pad = 8;

    const coords = points.map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.total - min) / range) * (h - pad * 2);
      return [x, y];
    });

    const path = coords
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");

    const areaPath =
      path +
      ` L${coords[coords.length - 1][0].toFixed(1)},${h} L${coords[0][0].toFixed(
        1
      )},${h} Z`;

    const dots = coords
      .map(
        ([x, y]) =>
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(
            1
          )}" r="2.5" fill="var(--accent)"></circle>`
      )
      .join("");

    svg.innerHTML = `
      <path d="${areaPath}" fill="rgba(0,255,157,0.08)" stroke="none"></path>
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
      ${dots}
    `;
  }

  function renderProgressTab(a) {
    const pct = Math.max(0, Math.min(100, (a.currentTotal / GOAL) * 100));
    $("progress-bar-fill").style.width = pct.toFixed(2) + "%";
    $("progress-current").textContent = fmt(a.currentTotal);
    $("progress-target").textContent = fmt(GOAL);

    $("prog-remaining").textContent = fmt(a.remaining);
    $("prog-rate").textContent = a.hasEnoughData
      ? fmtSigned(Math.round(a.rateAll)) + "/dia"
      : "—";
    $("prog-days").textContent =
      a.etaDays !== null ? Math.ceil(a.etaDays) + " dias" : "—";
    $("prog-date").textContent = a.etaDate
      ? a.etaDate.toLocaleDateString("pt-PT")
      : "—";

    $("prog-rate-7d").textContent = a.hasEnoughData
      ? fmtSigned(Math.round(a.rate7d)) + "/dia"
      : "—";
    $("prog-rate-all").textContent = a.hasEnoughData
      ? fmtSigned(Math.round(a.rateAll)) + "/dia"
      : "—";

    const paceLabelMap = {
      acima: ["phase-normal", "Acima do ritmo"],
      abaixo: ["phase-cooldown", "Abaixo do ritmo"],
      "no-ritmo": ["phase-burst", "No ritmo"],
      indeterminado: ["phase-unknown", "—"],
    };
    const el = $("prog-pace-state");
    el.classList.remove("phase-normal", "phase-burst", "phase-cooldown", "phase-unknown");
    const [cls, label] = paceLabelMap[a.paceState] || paceLabelMap.indeterminado;
    el.classList.add(cls);
    el.textContent = label;
  }

  function renderCyclesTab(a) {
    $("cyc-normal-rate").textContent = a.normalRate
      ? fmtSigned(Math.round(a.normalRate)) + "/dia"
      : "—";
    $("cyc-burst-rate").textContent = a.burstRate
      ? fmtSigned(Math.round(a.burstRate)) + "/burst"
      : "—";
    $("cyc-cooldown-days").textContent = a.hasEnoughData
      ? String(a.cooldownCount)
      : "—";
    $("cyc-consistency").textContent = a.hasEnoughData
      ? Math.round(a.consistency * 100) + "%"
      : "—";

    const wrap = $("cycles-timeline");
    if (!a.classified.length) {
      wrap.innerHTML =
        '<p class="empty-hint">Sem dados suficientes ainda. A timeline aparece com o histórico de snapshots.</p>';
      return;
    }
    const colorMap = {
      normal: "var(--accent)",
      burst: "var(--amber)",
      cooldown: "var(--red)",
    };
    const maxAbs = Math.max(...a.classified.map((d) => Math.abs(d.delta)), 1);
    wrap.innerHTML = a.classified
      .slice()
      .reverse()
      .slice(0, 30)
      .map((d) => {
        const widthPct = Math.max(4, (Math.abs(d.delta) / maxAbs) * 100);
        const dateLabel = new Date(d.date + "T12:00:00").toLocaleDateString(
          "pt-PT",
          { day: "2-digit", month: "2-digit" }
        );
        return `<div class="cycle-row">
          <span class="cycle-date">${dateLabel}</span>
          <span class="cycle-bar-track"><span class="cycle-bar-fill" style="width:${widthPct}%;background:${colorMap[d.phase]}"></span></span>
          <span class="cycle-delta" style="color:${colorMap[d.phase]}">${fmtSigned(d.delta)}</span>
        </div>`;
      })
      .join("");
  }

  function renderHistoryTab(snapshots) {
    const daily = getDailySeries(snapshots);
    $("history-count").textContent = String(snapshots.length);
    const wrap = $("history-table");
    if (!daily.length) {
      wrap.innerHTML =
        '<p class="empty-hint">Ainda sem snapshots guardados. Os snapshots são criados automaticamente uma vez por dia.</p>';
      return;
    }
    wrap.innerHTML = daily
      .slice()
      .reverse()
      .map((s, i, arr) => {
        const prev = arr[i + 1];
        const delta = prev ? s.total - prev.total : null;
        const dateLabel = new Date(s.date + "T12:00:00").toLocaleDateString(
          "pt-PT",
          { day: "2-digit", month: "2-digit", year: "numeric" }
        );
        const deltaText =
          delta === null ? "—" : delta >= 0 ? "delta-pos" : "delta-neg";
        return `<div class="history-row">
          <span class="history-date">${dateLabel}</span>
          <span class="history-total">${fmt(s.total)}</span>
          <span class="history-delta ${delta === null ? "" : deltaText}">${
          delta === null ? "—" : fmtSigned(delta)
        }</span>
        </div>`;
      })
      .join("");
  }

  const WEEKDAY_NAMES = [
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
    "Domingo",
  ];

  function renderPlannerTab(a) {
    const wrap = $("planner-week");
    const actionMap = {
      normal: "Treino constante recomendado — sem ciclos especiais.",
      burst: "Dia historicamente de burst — considera ciclo de Xanax / Happy Jumps.",
      cooldown: "Historicamente abranda — bom dia para descanso / cooldown.",
      unknown: "Sem dados suficientes para este dia. Sugestão padrão: treino normal.",
    };
    wrap.innerHTML = a.weekdayPattern
      .map((w, i) => {
        const phase = w.phase;
        return `<div class="planner-day">
          <span class="planner-day-name">${WEEKDAY_NAMES[i]}</span>
          <span class="planner-day-action">${actionMap[phase]}${
          w.n ? ` (${w.n} amostra${w.n > 1 ? "s" : ""})` : ""
        }</span>
          <span class="phase-tag phase-${phase}">${
          phase === "unknown" ? "—" : phase
        }</span>
        </div>`;
      })
      .join("");

    const nextAction = $("planner-next-action");
    if (!a.hasEnoughData) {
      nextAction.textContent =
        "Sem histórico suficiente ainda. Continua a usar a app diariamente para receberes recomendações personalizadas.";
      return;
    }
    const phaseActionMap = {
      normal:
        "Continua o treino constante de hoje. O padrão histórico não indica necessidade de burst ou cooldown imediato.",
      burst:
        "Estás em burst — aproveita para maximizar ganhos hoje e planeia um dia de cooldown a seguir para recuperar.",
      cooldown:
        "Estás em cooldown — este é um bom momento para iniciar um novo ciclo de Xanax / Happy Jumps e reativar o crescimento.",
      unknown: "Continua a recolher dados para gerar uma recomendação personalizada.",
    };
    nextAction.textContent = phaseActionMap[a.currentPhase];
  }

  function renderAll(data, snapshots, analytics) {
    renderTopbar(data);
    renderRing(analytics);
    renderStatGrid(data);
    renderKpis(analytics);
    renderInsights(analytics, data);
    renderMiniChart(analytics);
    renderProgressTab(analytics);
    renderCyclesTab(analytics);
    renderHistoryTab(snapshots);
    renderPlannerTab(analytics);
  }

  // ===========================================================
  // Main load / refresh cycle
  // ===========================================================
  async function loadAndRender(prefetchedData) {
    try {
      const apiKey = localStorage.getItem(K.apiKey);
      const data = prefetchedData || (await fetchTornData(apiKey));
      const snapshot = buildSnapshotFromData(data);
      const snapshots = addAutoSnapshotIfNeeded(snapshot);
      const analytics = computeAnalytics(snapshots);
      renderAll(data, snapshots, analytics);
      window.__tps_lastData = data;
    } catch (e) {
      toast("Erro ao atualizar: " + (e.message || "falha desconhecida."));
    }
  }

  $("refresh-btn").addEventListener("click", async () => {
    const btn = $("refresh-btn");
    btn.classList.add("is-spinning");
    await loadAndRender();
    btn.classList.remove("is-spinning");
    toast("Dados atualizados.");
  });

  $("manual-snapshot-btn").addEventListener("click", () => {
    const data = window.__tps_lastData;
    if (!data) {
      toast("Sem dados carregados ainda.");
      return;
    }
    const snapshot = buildSnapshotFromData(data);
    const snapshots = addManualSnapshot(snapshot);
    const analytics = computeAnalytics(snapshots);
    renderAll(data, snapshots, analytics);
    toast("Snapshot manual guardado.");
  });

  $("export-data-btn").addEventListener("click", () => {
    const snapshots = loadSnapshots();
    const blob = new Blob([JSON.stringify(snapshots, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "torn-stats-history.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Histórico exportado.");
  });

  $("clear-history-btn").addEventListener("click", () => {
    const sure = confirm("Apagar todo o histórico de snapshots guardado neste dispositivo?");
    if (!sure) return;
    localStorage.removeItem(K.snapshots);
    const data = window.__tps_lastData;
    if (data) {
      const analytics = computeAnalytics([]);
      renderAll(data, [], analytics);
    }
    toast("Histórico apagado.");
  });

  // ===========================================================
  // Tab navigation
  // ===========================================================
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      document
        .querySelectorAll(".nav-btn")
        .forEach((b) => b.classList.toggle("is-active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.hidden = panel.dataset.tab !== target;
      });
      document.querySelector(".tabs-wrap").scrollTop = 0;
    });
  });

  // ===========================================================
  // Routing between gate screens
  // ===========================================================
  function routeToNextScreen() {
    if (!hasPassword()) {
      showScreen("setupPassword");
      return;
    }
    if (!isSessionUnlocked()) {
      initLockScreenState();
      showScreen("lock");
      return;
    }
    if (!localStorage.getItem(K.apiKey)) {
      showScreen("apiSetup");
      return;
    }
    showScreen("app");
    loadAndRender();
  }

  // ===========================================================
  // Service worker registration (PWA / iPhone install)
  // ===========================================================
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ===========================================================
  // Init
  // ===========================================================
  routeToNextScreen();
})();
