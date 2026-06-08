function normalizeStatus(rawStatus) {
  const upper = String(rawStatus || "").toUpperCase();
  if (["FT", "AET", "PEN", "FINISHED"].includes(upper)) {
    return "FINISHED";
  }
  if (["LIVE", "IN_PLAY", "1H", "2H", "HT"].includes(upper)) {
    return "LIVE";
  }
  return "SCHEDULED";
}

function mapApiFootballResult(match) {
  const fixture = match.fixture || {};
  const teams = match.teams || {};
  const goals = match.goals || {};
  const status = fixture.status || {};

  return {
    providerMatchId: String(fixture.id || ""),
    status: normalizeStatus(status.short || status.long),
    homeTeamId: teams.home?.code || null,
    awayTeamId: teams.away?.code || null,
    winnerTeamId: teams.home?.winner ? teams.home?.code : teams.away?.winner ? teams.away?.code : null,
    score: {
      home: Number.isFinite(goals.home) ? goals.home : null,
      away: Number.isFinite(goals.away) ? goals.away : null
    },
    channel: match.channel || null,
    secondaryChannel: match.channel2 || null
  };
}

function mapFootballDataResult(match) {
  const homeCode = match.homeTeam?.tla || null;
  const awayCode = match.awayTeam?.tla || null;

  return {
    providerMatchId: String(match.id || ""),
    status: normalizeStatus(match.status),
    homeTeamId: homeCode,
    awayTeamId: awayCode,
    winnerTeamId: match.score?.winner === "HOME_TEAM" ? homeCode : match.score?.winner === "AWAY_TEAM" ? awayCode : null,
    score: {
      home: Number.isFinite(match.score?.fullTime?.home) ? match.score.fullTime.home : null,
      away: Number.isFinite(match.score?.fullTime?.away) ? match.score.fullTime.away : null
    },
    channel: null,
    secondaryChannel: null
  };
}

export default async function handler(request, response) {
  const provider = process.env.RESULTS_PROVIDER || "football-data";
  const updatedAt = new Date().toISOString();

  try {
    if (provider === "api-football") {
      const apiKey = process.env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return response.status(200).json({
          updatedAt,
          results: [],
          warning: "API_FOOTBALL_KEY not set"
        });
      }

      const season = request.query.season || "2026";
      const league = request.query.league || "1";
      const apiResponse = await fetch(
        `https://v3.football.api-sports.io/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`,
        {
          headers: {
            "x-apisports-key": apiKey
          }
        }
      );

      if (!apiResponse.ok) {
        throw new Error(`API-Football request failed with ${apiResponse.status}`);
      }

      const data = await apiResponse.json();
      const matches = Array.isArray(data.response) ? data.response : [];
      return response.status(200).json({
        updatedAt,
        results: matches.map(mapApiFootballResult)
      });
    }

    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      return response.status(200).json({
        updatedAt,
        results: [],
        warning: "FOOTBALL_DATA_API_KEY not set"
      });
    }

    const competition = request.query.competition || "WC";
    const apiResponse = await fetch(
      `https://api.football-data.org/v4/competitions/${encodeURIComponent(competition)}/matches`,
      {
        headers: {
          "X-Auth-Token": apiKey
        }
      }
    );

    if (!apiResponse.ok) {
      throw new Error(`Football-Data request failed with ${apiResponse.status}`);
    }

    const data = await apiResponse.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];

    return response.status(200).json({
      updatedAt,
      results: matches.map(mapFootballDataResult)
    });
  } catch (error) {
    return response.status(200).json({
      updatedAt,
      results: [],
      warning: error instanceof Error ? error.message : "Results fetch failed"
    });
  }
}
