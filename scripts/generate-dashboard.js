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
    if (
      dateDifferenceInDays(
        activeDays[i - 1],
        activeDays[i]
      ) === 1
    ) {
      runningStreak++;
      longestStreak = Math.max(
        longestStreak,
        runningStreak
      );
    } else {
      runningStreak = 1;
    }
  }

  const today = new Date();
  const todayString = today.toISOString().slice(0, 10);

  const yesterdayDate = new Date(today);
  yesterdayDate.setUTCDate(
    yesterdayDate.getUTCDate() - 1
  );

  const yesterdayString =
    yesterdayDate.toISOString().slice(0, 10);

  let currentStreak = 0;

  let startingDate = null;

  if (activeDays.includes(todayString)) {
    startingDate = todayString;
  } else if (activeDays.includes(yesterdayString)) {
    startingDate = yesterdayString;
  }

  if (startingDate) {
    let cursor = activeDays.indexOf(startingDate);
    currentStreak = 1;

    while (
      cursor > 0 &&
      dateDifferenceInDays(
        activeDays[cursor - 1],
        activeDays[cursor]
      ) === 1
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

function contributionColor(count, maxCount) {
  if (count === 0) {
    return "#161b22";
  }

  const ratio = count / Math.max(maxCount, 1);

  if (ratio <= 0.25) {
    return "#0e4429";
  }

  if (ratio <= 0.50) {
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
    ...allDays.map(
      (day) => day.contributionCount
    ),
    1
  );

  const startX = 62;
  const startY = 430;

  const cellSize = 11;
  const gap = 3;
  const step = cellSize + gap;

  let svg = "";

  calendar.weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x =
        startX + weekIndex * step;

      const y =
        startY + day.weekday * step;

      const fill = contributionColor(
        day.contributionCount,
        maxCount
      );

      svg += `
        <rect
          x="${x}"
          y="${y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
          fill="${fill}"
        >
          <title>${escapeXML(day.date)}: ${escapeXML(
        day.contributionCount
      )} contributions</title>
        </rect>
      `;
    });
  });

  return svg;
}

function buildDashboard(
  profile,
  repositories,
  calendar,
  streaks
) {
  const totalStars = repositories.reduce(
    (total, repo) =>
      total + repo.stargazers_count,
    0
  );

  const heatmap =
    buildContributionHeatmap(calendar);

  return `
<svg
  width="1100"
  height="640"
  viewBox="0 0 1100 640"
  xmlns="http://www.w3.org/2000/svg">

  <defs>

    <linearGradient
      id="headerGlow"
      x1="0"
      y1="0"
      x2="1"
      y2="0">

      <stop
        offset="0%"
        stop-color="#58a6ff"
        stop-opacity="0.25"/>

      <stop
        offset="50%"
        stop-color="#bc8cff"
        stop-opacity="0.10"/>

      <stop
        offset="100%"
        stop-color="#58a6ff"
        stop-opacity="0"/>

    </linearGradient>

  </defs>

  <!-- BACKGROUND -->

  <rect
    width="1100"
    height="640"
    rx="22"
    fill="#0d1117"/>

  <rect
    x="1"
    y="1"
    width="1098"
    height="638"
    rx="22"
    fill="none"
    stroke="#30363d"
    stroke-width="2"/>

  <!-- HEADER GLOW -->

  <rect
    x="25"
    y="25"
    width="1050"
    height="115"
    rx="16"
    fill="url(#headerGlow)"/>

  <!-- HEADER -->

  <text
    x="55"
    y="70"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="30"
    font-weight="700">
    PRIYANSHU.V
  </text>

  <text
    x="55"
    y="101"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    CSE STUDENT • DATA SCIENCE • MACHINE LEARNING • BUILDER
  </text>

  <circle
    cx="955"
    cy="65"
    r="7"
    fill="#3fb950"/>

  <text
    x="975"
    y="70"
    fill="#3fb950"
    font-family="monospace"
    font-size="13">
    BUILDING
  </text>

  <line
    x1="55"
    y1="130"
    x2="1045"
    y2="130"
    stroke="#30363d"/>

  <!-- PROFILE ANALYTICS -->

  <text
    x="55"
    y="165"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    GITHUB // PROFILE ANALYTICS
  </text>

  <!-- CARD 1 -->

  <rect
    x="55"
    y="185"
    width="225"
    height="105"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="75"
    y="217"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    REPOSITORIES
  </text>

  <text
    x="75"
    y="264"
    fill="#58a6ff"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(profile.public_repos)}
  </text>

  <!-- CARD 2 -->

  <rect
    x="295"
    y="185"
    width="225"
    height="105"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="315"
    y="217"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    CONTRIBUTIONS
  </text>

  <text
    x="315"
    y="264"
    fill="#39d353"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(calendar.totalContributions)}
  </text>

  <!-- CARD 3 -->

  <rect
    x="535"
    y="185"
    width="225"
    height="105"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="555"
    y="217"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    STARS
  </text>

  <text
    x="555"
    y="264"
    fill="#e3b341"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(totalStars)}
  </text>

  <!-- CARD 4 -->

  <rect
    x="775"
    y="185"
    width="270"
    height="105"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="795"
    y="217"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    FOLLOWERS
  </text>

  <text
    x="795"
    y="264"
    fill="#f85149"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(profile.followers)}
  </text>

  <text
    x="960"
    y="265"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    / ${escapeXML(profile.following)} FOLLOWING
  </text>

  <!-- CONTRIBUTION SECTION -->

  <line
    x1="55"
    y1="320"
    x2="1045"
    y2="320"
    stroke="#30363d"/>

  <text
    x="55"
    y="350"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    CONTRIBUTION // ACTIVITY
  </text>

  <!-- STREAK -->

  <rect
    x="55"
    y="365"
    width="255"
    height="55"
    rx="10"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="72"
    y="387"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    CURRENT STREAK
  </text>

  <text
    x="72"
    y="407"
    fill="#f85149"
    font-family="monospace"
    font-size="18"
    font-weight="700">
    ${escapeXML(streaks.currentStreak)} DAYS
  </text>

  <!-- BEST STREAK -->

  <rect
    x="325"
    y="365"
    width="255"
    height="55"
    rx="10"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="342"
    y="387"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    LONGEST STREAK
  </text>

  <text
    x="342"
    y="407"
    fill="#e3b341"
    font-family="monospace"
    font-size="18"
    font-weight="700">
    ${escapeXML(streaks.longestStreak)} DAYS
  </text>

  <!-- STATUS -->

  <rect
    x="595"
    y="365"
    width="450"
    height="55"
    rx="10"
    fill="#161b22"
    stroke="#21262d"/>

  <circle
    cx="620"
    cy="393"
    r="6"
    fill="#39d353"/>

  <text
    x="637"
    y="398"
    fill="#39d353"
    font-family="monospace"
    font-size="12">
    SYSTEM ONLINE
  </text>

  <text
    x="805"
    y="398"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    AUTO-GENERATED
  </text>

  <!-- HEATMAP -->

  <text
    x="55"
    y="448"
    fill="#8b949e"
    font-family="monospace"
    font-size="12">
    CONTRIBUTION MATRIX // LAST 12 MONTHS
  </text>

  ${heatmap}

  <!-- LEGEND -->

  <text
    x="850"
    y="590"
    fill="#8b949e"
    font-family="monospace"
    font-size="9">
    LESS
  </text>

  <rect
    x="885"
    y="581"
    width="11"
    height="11"
    rx="2"
    fill="#161b22"/>

  <rect
    x="902"
    y="581"
    width="11"
    height="11"
    rx="2"
    fill="#0e4429"/>

  <rect
    x="919"
    y="581"
    width="11"
    height="11"
    rx="2"
    fill="#006d32"/>

  <rect
    x="936"
    y="581"
    width="11"
    height="11"
    rx="2"
    fill="#26a641"/>

  <rect
    x="953"
    y="581"
    width="11"
    height="11"
    rx="2"
    fill="#39d353"/>

  <text
    x="972"
    y="590"
    fill="#8b949e"
    font-family="monospace"
    font-size="9">
    MORE
  </text>

  <!-- FOOTER -->

  <line
    x1="55"
    y1="610"
    x2="1045"
    y2="610"
    stroke="#21262d"/>

  <text
    x="55"
    y="628"
    fill="#3fb950"
    font-family="monospace"
    font-size="10">
    &gt; LIVE GITHUB DATA • UPDATED DAILY • PRIYANSHU.V
  </text>

</svg>
`;
}

async function main() {
  console.log(
    `Generating dashboard for ${username}...`
  );

  const [
    profile,
    repositories,
    calendar
  ] = await Promise.all([
    fetchGitHubProfile(),
    fetchRepositories(),
    fetchContributions()
  ]);

  const contributionDays =
    flattenContributionDays(calendar);

  const streaks =
    calculateStreaks(contributionDays);

  console.log("Profile:", {
    repositories: profile.public_repos,
    followers: profile.followers,
    following: profile.following
  });

  console.log(
    "Contributions:",
    calendar.totalContributions
  );

  console.log(
    "Current streak:",
    streaks.currentStreak
  );

  console.log(
    "Longest streak:",
    streaks.longestStreak
  );

  const dashboard = buildDashboard(
    profile,
    repositories,
    calendar,
    streaks
  );

  const outputDir =
    path.join(__dirname, "..", "assets");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {
      recursive: true
    });
  }

  const outputPath =
    path.join(
      outputDir,
      "dashboard.svg"
    );

  fs.writeFileSync(
    outputPath,
    dashboard.trim(),
    "utf8"
  );

  console.log(
    `Dashboard written to ${outputPath}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
