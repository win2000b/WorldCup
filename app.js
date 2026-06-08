const DATA_FILES = {
  owners: "./data/owners.json",
  teams: "./data/teams.json",
  fixtures: "./data/fixtures.json"
};

const CACHE_KEY = "worldcup_sweepstake_cache_v1";

const state = {
  owners: [],
  teams: [],
  fixtures: [],
  qualifierCandidates: {},
  stageFilter: "all",
  ownerFilter: "all",
  loadedAt: null,
  apiStatus: "not-run"
};

const fixtureListEl = document.querySelector("#fixtureList");
const ownerSummaryEl = document.querySelector("#ownerSummary");
const statusBarEl = document.querySelector("#statusBar");
const stageFilterEl = document.querySelector("#stageFilter");
const ownerFilterEl = document.querySelector("#ownerFilter");

const ukDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

init().catch((error) => {
  statusBarEl.textContent = "Unable to load fixture data.";
  fixtureListEl.innerHTML = `<article class="empty-state">${escapeHtml(error.message)}</article>`;
});

async function init() {
  const [owners, teams, fixtureBundle] = await Promise.all([
    fetchJson(DATA_FILES.owners),
    fetchJson(DATA_FILES.teams),
    fetchJson(DATA_FILES.fixtures)
  ]);

  state.owners = owners;
  state.teams = teams;
  state.qualifierCandidates = fixtureBundle.qualifierCandidates || {};
  state.fixtures = fixtureBundle.fixtures || [];

  hydrateFromCache();
  setupFilters();
  render();

  await refreshResults();
  render();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

function hydrateFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return;
    }
    const cached = JSON.parse(raw);
    if (!Array.isArray(cached.fixtures)) {
      return;
    }
    state.fixtures = mergeFixtures(state.fixtures, cached.fixtures);
    state.loadedAt = cached.updatedAt || null;
    state.apiStatus = "cache";
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}

function setupFilters() {
  const stages = [...new Set(state.fixtures.map((fixture) => fixture.stage))];
  stages.forEach((stage) => {
    const option = document.createElement("option");
    option.value = stage;
    option.textContent = stage;
    stageFilterEl.append(option);
  });

  state.owners.forEach((owner) => {
    const option = document.createElement("option");
    option.value = owner.id;
    option.textContent = owner.name;
    ownerFilterEl.append(option);
  });

  stageFilterEl.addEventListener("change", () => {
    state.stageFilter = stageFilterEl.value;
    render();
  });

  ownerFilterEl.addEventListener("change", () => {
    state.ownerFilter = ownerFilterEl.value;
    render();
  });
}

async function refreshResults() {
  try {
    const response = await fetch("/api/results");
    if (!response.ok) {
      throw new Error("Results API not available.");
    }

    const payload = await response.json();
    if (!Array.isArray(payload.results)) {
      throw new Error("Results payload malformed.");
    }

    state.fixtures = mergeResultsIntoFixtures(state.fixtures, payload.results);
    state.loadedAt = payload.updatedAt || new Date().toISOString();
    state.apiStatus = "live";

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fixtures: state.fixtures,
        updatedAt: state.loadedAt
      })
    );
  } catch {
    if (state.apiStatus !== "cache") {
      state.apiStatus = "offline";
    }
  }
}

function mergeResultsIntoFixtures(fixtures, results) {
  const byResultKey = new Map();

  results.forEach((result) => {
    if (result.providerMatchId) {
      byResultKey.set(result.providerMatchId, result);
    }
    if (result.id) {
      byResultKey.set(result.id, result);
    }
  });

  return fixtures.map((fixture) => {
    const key = fixture.source?.providerMatchId || fixture.id;
    const result = byResultKey.get(key);
    if (!result) {
      return fixture;
    }

    const nextFixture = { ...fixture };
    nextFixture.status = result.status || fixture.status;

    if (result.score) {
      nextFixture.score = {
        home: result.score.home,
        away: result.score.away
      };
    }

    if (result.channel) {
      nextFixture.channel = result.channel;
      nextFixture.channelSource = "api";
    }
    if (result.secondaryChannel) {
      nextFixture.secondaryChannel = result.secondaryChannel;
    }

    if (result.homeTeamId) {
      nextFixture.homeSlot = {
        type: "TEAM",
        teamId: result.homeTeamId,
        label: getTeamName(result.homeTeamId)
      };
    }

    if (result.awayTeamId) {
      nextFixture.awaySlot = {
        type: "TEAM",
        teamId: result.awayTeamId,
        label: getTeamName(result.awayTeamId)
      };
    }

    if (result.winnerTeamId) {
      nextFixture.winnerTeamId = result.winnerTeamId;
    }

    return nextFixture;
  });
}

function mergeFixtures(baseFixtures, patchFixtures) {
  const patchById = new Map(patchFixtures.map((fixture) => [fixture.id, fixture]));
  return baseFixtures.map((fixture) => {
    const patch = patchById.get(fixture.id);
    return patch ? { ...fixture, ...patch } : fixture;
  });
}

function render() {
  const renderedFixtures = state.fixtures
    .map((fixture) => enrichFixture(fixture))
    .filter((fixture) => filterFixture(fixture))
    .sort(sortFixture);

  renderStatusBar();
  renderFixtureList(renderedFixtures);
  renderOwnerSummary();
}

function renderStatusBar() {
  const sourceText =
    state.apiStatus === "live"
      ? "Live results connected"
      : state.apiStatus === "cache"
        ? "Showing cached results"
        : state.apiStatus === "offline"
          ? "Results feed unavailable, showing saved fixtures"
          : "Loading fixtures";

  const lastUpdate = state.loadedAt
    ? `Last updated ${ukDateTimeFormat.format(new Date(state.loadedAt))} UK`
    : "No results fetched yet";

  statusBarEl.textContent = `${sourceText}. ${lastUpdate}.`;
}

function renderFixtureList(fixtures) {
  if (fixtures.length === 0) {
    fixtureListEl.innerHTML = '<article class="empty-state">No fixtures match your filters.</article>';
    return;
  }

  fixtureListEl.innerHTML = fixtures
    .map((fixture) => {
      const homeTeam = fixture.home;
      const awayTeam = fixture.away;
      const homeOwner = teamOwnerLabel(homeTeam.teamId, fixture.homeCandidates);
      const awayOwner = teamOwnerLabel(awayTeam.teamId, fixture.awayCandidates);
      const hasScore = fixture.score && Number.isFinite(fixture.score.home) && Number.isFinite(fixture.score.away);
      const badgeClass = getStatusClass(fixture.status);
      const homeFlag = teamFlag(homeTeam.teamId);
      const awayFlag = teamFlag(awayTeam.teamId);

      return `
        <article class="fixture-card">
          <div class="fixture-head">
            <div class="round">${escapeHtml(fixture.roundLabel)}</div>
            <span class="badge ${badgeClass}">${escapeHtml(statusLabel(fixture.status))}</span>
          </div>
          <div class="matchup">
            <div class="matchup-team home">
              <span class="flag" aria-hidden="true">${homeFlag}</span>
              <span class="team-name">${escapeHtml(homeTeam.label)}</span>
              <span class="team-chip">${escapeHtml(homeOwner)}</span>
            </div>
            <div class="matchup-score">
              ${hasScore
                ? `<span class="score-val">${fixture.score.home}</span><span class="score-sep">&ndash;</span><span class="score-val">${fixture.score.away}</span>`
                : `<span class="score-vs">vs</span>`}
            </div>
            <div class="matchup-team away">
              <span class="flag" aria-hidden="true">${awayFlag}</span>
              <span class="team-name">${escapeHtml(awayTeam.label)}</span>
              <span class="team-chip">${escapeHtml(awayOwner)}</span>
            </div>
          </div>
          <div class="fixture-meta">
            <span>🕐 ${escapeHtml(formatUkDate(fixture.kickoffUtc))}</span>
            <span>📺 ${escapeHtml(formatChannel(fixture))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderOwnerSummary() {
  const ownerCards = state.owners
    .map((owner) => {
      const teams = state.teams.filter((team) => team.ownerId === owner.id);
      if (teams.length === 0) {
        return null;
      }
      return `
        <article class="owner-card">
          <h3 class="owner-card-name">${escapeHtml(owner.name)}</h3>
          <ul class="team-list">
            ${teams.map((team) => `<li>${escapeHtml(team.name)}</li>`).join("")}
          </ul>
        </article>
      `;
    })
    .filter(Boolean)
    .join("");

  ownerSummaryEl.innerHTML = ownerCards || '<article class="empty-state">No team ownership loaded yet.</article>';
}

function enrichFixture(fixture) {
  const home = resolveSlot(fixture.homeSlot, fixture.id);
  const away = resolveSlot(fixture.awaySlot, fixture.id);

  return {
    ...fixture,
    home,
    away,
    homeCandidates: home.candidateTeamIds,
    awayCandidates: away.candidateTeamIds
  };
}

function resolveSlot(slot, fixtureId, seen = new Set()) {
  if (!slot) {
    return { label: "TBC", teamId: null, candidateTeamIds: [] };
  }

  if (slot.type === "TEAM") {
    return {
      label: getTeamName(slot.teamId) || slot.label || "TBC",
      teamId: slot.teamId,
      candidateTeamIds: slot.teamId ? [slot.teamId] : []
    };
  }

  if (slot.type === "QUALIFIER") {
    const candidates = state.qualifierCandidates[slot.qualifierKey] || [];
    return {
      label: slot.label || slot.qualifierKey || "TBC",
      teamId: null,
      candidateTeamIds: candidates
    };
  }

  if (slot.type === "WINNER_OF_MATCH") {
    if (!slot.matchRef || seen.has(slot.matchRef)) {
      return {
        label: slot.label || "Winner TBD",
        teamId: null,
        candidateTeamIds: []
      };
    }

    const referencedFixture = state.fixtures.find((fixture) => fixture.id === slot.matchRef);
    if (!referencedFixture) {
      return {
        label: slot.label || "Winner TBD",
        teamId: null,
        candidateTeamIds: []
      };
    }

    if (referencedFixture.winnerTeamId) {
      return {
        label: getTeamName(referencedFixture.winnerTeamId) || slot.label || "Winner",
        teamId: referencedFixture.winnerTeamId,
        candidateTeamIds: [referencedFixture.winnerTeamId]
      };
    }

    const nextSeen = new Set(seen);
    nextSeen.add(fixtureId);
    const home = resolveSlot(referencedFixture.homeSlot, slot.matchRef, nextSeen);
    const away = resolveSlot(referencedFixture.awaySlot, slot.matchRef, nextSeen);
    return {
      label: slot.label || `Winner ${slot.matchRef}`,
      teamId: null,
      candidateTeamIds: uniq([...home.candidateTeamIds, ...away.candidateTeamIds])
    };
  }

  return {
    label: slot.label || "TBC",
    teamId: null,
    candidateTeamIds: []
  };
}

function filterFixture(fixture) {
  if (state.stageFilter !== "all" && fixture.stage !== state.stageFilter) {
    return false;
  }

  if (state.ownerFilter === "all") {
    return true;
  }

  const teamIds = uniq([fixture.home.teamId, fixture.away.teamId, ...fixture.homeCandidates, ...fixture.awayCandidates].filter(Boolean));
  return teamIds.some((teamId) => getOwnerIdByTeamId(teamId) === state.ownerFilter);
}

function sortFixture(a, b) {
  const dateA = Date.parse(a.kickoffUtc);
  const dateB = Date.parse(b.kickoffUtc);
  if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) {
    return dateA - dateB;
  }
  return (a.sortIndex || 0) - (b.sortIndex || 0);
}

function teamOwnerLabel(teamId, candidateTeamIds = []) {
  if (teamId) {
    const owner = getOwnerById(getOwnerIdByTeamId(teamId));
    return owner ? owner.name : "Unassigned";
  }

  const ownerNames = uniq(
    candidateTeamIds
      .map((id) => getOwnerById(getOwnerIdByTeamId(id)))
      .filter(Boolean)
      .map((owner) => owner.name)
  );

  return ownerNames.length ? `Possible: ${ownerNames.join(", ")}` : "Owner TBC";
}

function getTeamName(teamId) {
  return state.teams.find((team) => team.id === teamId)?.name || "TBC";
}

function getOwnerById(ownerId) {
  return state.owners.find((owner) => owner.id === ownerId) || null;
}

// Maps team ID -> ISO 3166-1 alpha-2 code used by flagcdn.com
const TEAM_ISO = {
  MEX: 'mx', RSA: 'za', KOR: 'kr', CZE: 'cz',
  CAN: 'ca', BIH: 'ba', QAT: 'qa', SUI: 'ch',
  BRA: 'br', MAR: 'ma', HAI: 'ht', SCO: 'gb-sct',
  USA: 'us', PAR: 'py', AUS: 'au', TUR: 'tr',
  GER: 'de', CUW: 'cw', CIV: 'ci', ECU: 'ec',
  NED: 'nl', JPN: 'jp', SWE: 'se', TUN: 'tn',
  BEL: 'be', EGY: 'eg', IRN: 'ir', NZL: 'nz',
  ESP: 'es', CPV: 'cv', KSA: 'sa', URU: 'uy',
  FRA: 'fr', SEN: 'sn', IRQ: 'iq', NOR: 'no',
  ARG: 'ar', ALG: 'dz', AUT: 'at', JOR: 'jo',
  POR: 'pt', COD: 'cd', UZB: 'uz', COL: 'co',
  ENG: 'gb-eng', CRO: 'hr', GHA: 'gh', PAN: 'pa'
};

function teamFlag(teamId) {
  const iso = TEAM_ISO[teamId];
  if (!iso) {
    return '<span class="flag-placeholder">?</span>';
  }
  const name = escapeHtml(teamId);
  return `<img class="flag-img" src="https://flagcdn.com/h40/${iso}.png" srcset="https://flagcdn.com/h80/${iso}.png 2x" alt="${name} flag" loading="lazy">`;
}

function getOwnerIdByTeamId(teamId) {
  return state.teams.find((team) => team.id === teamId)?.ownerId || null;
}

function formatUkDate(utcIso) {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    return "TBC";
  }
  return `${ukDateTimeFormat.format(date)} UK`;
}

function formatChannel(fixture) {
  const primary = fixture.channel || "TBC";
  return fixture.secondaryChannel ? `${primary} / ${fixture.secondaryChannel}` : primary;
}

function statusLabel(status) {
  switch ((status || "").toUpperCase()) {
    case "LIVE":
      return "Live";
    case "FINISHED":
    case "FT":
      return "Full Time";
    case "SCHEDULED":
      return "Scheduled";
    default:
      return "Update pending";
  }
}

function getStatusClass(status) {
  const upper = (status || "").toUpperCase();
  if (upper === "LIVE") {
    return "live";
  }
  if (upper === "FINISHED" || upper === "FT") {
    return "ft";
  }
  return "";
}

function uniq(values) {
  return [...new Set(values)];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
