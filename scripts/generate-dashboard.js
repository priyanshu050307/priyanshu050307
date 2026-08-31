const fs = require("fs");
const path = require("path");

const username = "priyanshu050307";
const githubToken = process.env.GITHUB_TOKEN;

if (!githubToken) {
  throw new Error("GITHUB_TOKEN is not available.");
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "github-profile-dashboard",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  return response.json();
}

async function fetchGitHubProfile() {
  return fetchJSON(`https://api.github.com/users/${username}`);
}

async function fetchRepositories() {
  const repositories = [];
  let page = 1;

  while (true) {
    const repos = await fetchJSON(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner&sort=updated`
    );

    repositories.push(...repos);

    if (repos.length < 100) {
      break;
    }

    page++;
  }

  return repositories;
}

async function fetchContributions() {
  const today = new Date();

  const from = new Date(today);
  from.setUTCFullYear(from.getUTCFullYear() - 1);

  const to = new Date(today);
  to.setUTCHours(23, 59, 59, 999);

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                color
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const result = await fetchJSON("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString()
      }
    })
  });

  if (result.errors) {
    throw new Error(
      `GitHub GraphQL error:\n${JSON.stringify(result.errors, null, 2)}`
    );
  }

  const calendar =
    result.data?.user?.contributionsCollection?.contributionCalendar;

  if (!calendar) {
    throw new Error("Contribution calendar was not returned.");
  }

  return calendar;
}

function flattenContributionDays(calendar) {
  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dateDifferenceInDays(a, b) {
  const first = new Date(`${a}T00:00:00Z`);
  const second = new Date(`${b}T00:00:00Z`);

  return Math.round((second - first) / 86400000);
}

function calculateStreaks(days) {
  const activeDays = days
    .filter((day) => day.contributionCount > 0)
    .map((day) => day.date);

  if (activeDays.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0
    };
  }

  let longestStreak = 1;
  let runningStreak = 1;

  for (let i = 1; i < activeDays.length; i++) {
    if (dateDifferenceInDays(activeDays[i - 1], activeDays[i]) === 1) {
      runningStreak++;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 1;
    }
  }

  const today = new Date();
  const todayString = today.toISOString().slice(0, 10);

  const yesterdayDate = new Date(today);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayString = yesterdayDate.toISOString().slice(0, 10);

  let currentStreak = 0;

  if (activeDays.includes(todayString)) {
    currentStreak = 1;

    let cursor = activeDays.indexOf(todayString);

    while (
      cursor > 0 &&
      dateDifferenceInDays(activeDays[cursor - 1], activeDays[cursor]) === 1
    ) {
      currentStreak++;
      cursor--;
    }
  } else if (activeDays.includes(yesterdayString)) {
    currentStreak = 1;

    let cursor = activeDays.indexOf(yesterdayString);

    while (
      cursor > 0 &&
      dateDifferenceInDays(activeDays[cursor - 1], activeDays[cursor]) === 1
    ) {
      currentStreak++;
      cursor--;
    }
  }

  return {
    currentStreak,
    longestStreak
  };
}

function escapeXML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getContributionColor(count, maxCount) {
  if (count === 0) {
    return "#161b22";
  }

  const ratio = count / Math.max(maxCount, 1);

  if (ratio <= 0.25) {
    return "#0e4429";
  }

  if (ratio <= 0.5) {
    return "#006d32";
  }

  if (ratio <= 0.75) {
    return "#26a641";
  }

  return "#39d353";
}

function buildContributionHeatmap(calendar) {
  const allDays = flattenContributionDays(calendar);

  const maxCount = Math.max(
    ...allDays.map((day) => day.contributionCount),
    1
  );

  const startX = 50;
  const startY = 430;
  const cellSize = 12;
  const gap = 4;
  const step = cellSize + gap;

  let cells = "";

  calendar.weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x = startX + weekIndex * step;
      const y = startY + day.weekday * step;

      cells += `
        <rect
          x="${x}"
          y="${y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
          fill="${getContributionColor(day.contributionCount, maxCount)}">
          <title>${escapeXML(day.date)}: ${escapeXML(day.contributionCount)} contributions</title>
        </rect>
      `;
    });
  });

  return cells;
}

function buildDashboard(profile, repositories, calendar, streaks) {
  const totalStars = repositories.reduce(
    (total, repo) => total + repo.stargazers_count,
    0
  );

  const heatmap = buildContributionHeatmap(calendar);

  return `
<svg
  width="1000"
  height="570"
  viewBox="0 0 1000 570"
  xmlns="http://www.w3.org/2000/svg">

  <rect
    width="1000"
    height="570"
    rx="18"
    fill="#0d1117"
  />

  <rect
    x="1"
    y="1"
    width="998"
    height="568"
    rx="18"
    fill="none"
    stroke="#30363d"
    stroke-width="2"
  />

  <!-- HEADER -->

  <text
    x="50"
    y="60"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="27"
    font-weight="bold">
    PRIYANSHU VISHWAKARMA
  </text>

  <text
    x="50"
    y="92"
    fill="#8b949e"
    font-family="monospace"
    font-size="15">
    CSE STUDENT • DATA SCIENCE • MACHINE LEARNING
  </text>

  <circle
    cx="880"
    cy="58"
    r="6"
    fill="#3fb950"
  />

  <text
    x="895"
    y="64"
    fill="#3fb950"
    font-family="monospace"
    font-size="13">
    BUILDING
  </text>

  <line
    x1="50"
    y1="125"
    x2="950"
    y2="125"
    stroke="#30363d"
  />

  <!-- PROFILE STATS -->

  <text
    x="50"
    y="158"
    fill="#8b949e"
    font-family="monospace"
    font-size="13">
    GITHUB PROFILE
  </text>

  <text
    x="60"
    y="215"
    fill="#58a6ff"
    font-family="monospace"
    font-size="34"
    font-weight="bold">
    ${escapeXML(profile.public_repos)}
  </text>

  <text
    x="60"
    y="240"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    REPOSITORIES
  </text>

  <text
    x="275"
    y="215"
    fill="#f85149"
    font-family="monospace"
    font-size="34"
    font-weight="bold">
    ${escapeXML(profile.followers)}
  </text>

  <text
    x="275"
    y="240"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    FOLLOWERS
  </text>

  <text
    x="490"
    y="215"
    fill="#d2a8ff"
    font-family="monospace"
    font-size="34"
    font-weight="bold">
    ${escapeXML(totalStars)}
  </text>

  <text
    x="490"
    y="240"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    STARS
  </text>

  <text
    x="705"
    y="215"
    fill="#e3b341"
    font-family="monospace"
    font-size="34"
    font-weight="bold">
    ${escapeXML(profile.following)}
  </text>

  <text
    x="705"
    y="240"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    FOLLOWING
  </text>

  <line
    x1="50"
    y1="275"
    x2="950"
    y2="275"
    stroke="#30363d"
  />

  <!-- CONTRIBUTION STATS -->

  <text
    x="50"
    y="308"
    fill="#8b949e"
    font-family="monospace"
    font-size="13">
    CONTRIBUTION INTELLIGENCE
  </text>

  <text
    x="60"
    y="360"
    fill="#39d353"
    font-family="monospace"
    font-size="32"
    font-weight="bold">
    ${escapeXML(calendar.totalContributions)}
  </text>

  <text
    x="60"
    y="382"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    CONTRIBUTIONS
  </text>

  <text
    x="355"
    y="360"
    fill="#f85149"
    font-family="monospace"
    font-size="32"
    font-weight="bold">
    ${escapeXML(streaks.currentStreak)}
  </text>

  <text
    x="355"
    y="382"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    CURRENT STREAK
  </text>

  <text
    x="650"
    y="360"
    fill="#e3b341"
    font-family="monospace"
    font-size="32"
    font-weight="bold">
    ${escapeXML(streaks.longestStreak)}
  </text>

  <text
    x="650"
    y="382"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    LONGEST STREAK
  </text>

  <!-- CONTRIBUTION HEATMAP -->

  <text
    x="50"
    y="415"
    fill="#8b949e"
    font-family="monospace"
    font-size="13">
    CONTRIBUTION MATRIX
  </text>

  ${heatmap}

  <!-- FOOTER -->

  <line
    x1="50"
    y1="545"
    x2="950"
    y2="545"
    stroke="#30363d"
  />

  <text
    x="50"
    y="562"
    fill="#3fb950"
    font-family="monospace"
    font-size="11">
    &gt; LIVE GITHUB DATA • AUTO-GENERATED • UPDATED DAILY
  </text>

</svg>
`;
}

async function main() {
  console.log(`Generating dashboard for ${username}...`);

  const [profile, repositories, calendar] = await Promise.all([
    fetchGitHubProfile(),
    fetchRepositories(),
    fetchContributions()
  ]);

  const contributionDays = flattenContributionDays(calendar);
  const streaks = calculateStreaks(contributionDays);

  console.log("Profile:");
  console.log({
    repositories: profile.public_repos,
    followers: profile.followers,
    following: profile.following
  });

  console.log("Contributions:", calendar.totalContributions);
  console.log("Current streak:", streaks.currentStreak);
  console.log("Longest streak:", streaks.longestStreak);

  const dashboard = buildDashboard(
    profile,
    repositories,
    calendar,
    streaks
  );

  const outputDir = path.join(__dirname, "..", "assets");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, "dashboard.svg");

  fs.writeFileSync(outputPath, dashboard.trim(), "utf8");

  console.log(`Dashboard written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
