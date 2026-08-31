const fs = require("fs");
const path = require("path");

const username = "priyanshu050307";
const githubToken = process.env.GITHUB_TOKEN;

if (!githubToken) {
  throw new Error("GITHUB_TOKEN is not available.");
}

const API_HEADERS = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${githubToken}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "priyanshu-github-dashboard"
};

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...API_HEADERS,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `GitHub request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  return response.json();
}

async function fetchProfile() {
  return githubRequest(
    `https://api.github.com/users/${username}`
  );
}

async function fetchRepositories() {
  const repositories = [];
  let page = 1;

  while (true) {
    const repos = await githubRequest(
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

async function fetchRepositoryLanguages(repo) {
  try {
    return await githubRequest(
      `https://api.github.com/repos/${repo.full_name}/languages`
    );
  } catch (error) {
    console.warn(
      `Could not fetch languages for ${repo.full_name}: ${error.message}`
    );

    return {};
  }
}

async function fetchLanguageStatistics(repositories) {
  const totals = {};

  const languageResults = await Promise.all(
    repositories.map((repo) =>
      fetchRepositoryLanguages(repo)
    )
  );

  languageResults.forEach((languages) => {
    Object.entries(languages).forEach(
      ([language, bytes]) => {
        totals[language] =
          (totals[language] || 0) + bytes;
      }
    );
  });

  const totalBytes = Object.values(totals).reduce(
    (sum, value) => sum + value,
    0
  );

  if (totalBytes === 0) {
    return [];
  }

  return Object.entries(totals)
    .map(([language, bytes]) => ({
      language,
      bytes,
      percentage:
        (bytes / totalBytes) * 100
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);
}

async function fetchContributions() {
  const today = new Date();

  const from = new Date(today);
  from.setUTCFullYear(
    from.getUTCFullYear() - 1
  );
  from.setUTCHours(0, 0, 0, 0);

  const to = new Date(today);
  to.setUTCHours(23, 59, 59, 999);

  const query = `
    query(
      $login: String!,
      $from: DateTime!,
      $to: DateTime!
    ) {
      user(login: $login) {
        contributionsCollection(
          from: $from
          to: $to
        ) {
          contributionCalendar {
            totalContributions
            weeks {
              firstDay
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

  const result = await githubRequest(
    "https://api.github.com/graphql",
    {
      method: "POST",
      headers: {
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
    }
  );

  if (result.errors) {
    throw new Error(
      `GitHub GraphQL error:\n${JSON.stringify(
        result.errors,
        null,
        2
      )}`
    );
  }

  const calendar =
    result.data?.user?.contributionsCollection
      ?.contributionCalendar;

  if (!calendar) {
    throw new Error(
      "Contribution calendar was not returned."
    );
  }

  return calendar;
}

function flattenContributionDays(calendar) {
  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .sort((a, b) =>
      a.date.localeCompare(b.date)
    );
}

function differenceInDays(start, end) {
  const first = new Date(
    `${start}T00:00:00Z`
  );

  const second = new Date(
    `${end}T00:00:00Z`
  );

  return Math.round(
    (second - first) / 86400000
  );
}

function calculateStreaks(days) {
  const activeDays = days
    .filter(
      (day) => day.contributionCount > 0
    )
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
      differenceInDays(
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

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const yesterday = new Date();

  yesterday.setUTCDate(
    yesterday.getUTCDate() - 1
  );

  const yesterdayString = yesterday
    .toISOString()
    .slice(0, 10);

  let anchor = null;

  if (activeDays.includes(today)) {
    anchor = today;
  } else if (
    activeDays.includes(yesterdayString)
  ) {
    anchor = yesterdayString;
  }

  let currentStreak = 0;

  if (anchor) {
    let index =
      activeDays.indexOf(anchor);

    currentStreak = 1;

    while (
      index > 0 &&
      differenceInDays(
        activeDays[index - 1],
        activeDays[index]
      ) === 1
    ) {
      currentStreak++;
      index--;
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

function shortRepositoryName(name) {
  const max = 24;

  if (name.length <= max) {
    return name;
  }

  return `${name.slice(0, max - 3)}...`;
}

function languageColor(language) {
  const colors = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    "C++": "#f34b7d",
    Java: "#b07219",
    HTML: "#e34c26",
    CSS: "#563d7c",
    SQL: "#e38c00",
    Shell: "#89e051",
    Dart: "#00B4AB",
    Kotlin: "#A97BFF",
    Go: "#00ADD8",
    Rust: "#dea584",
    PHP: "#4F5D95",
    C: "#555555"
  };

  return colors[language] || "#8b949e";
}

function contributionColor(count, maxCount) {
  if (count === 0) {
    return "#161b22";
  }

  const ratio =
    count / Math.max(maxCount, 1);

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
  const weeks = calendar.weeks;

  const allDays =
    flattenContributionDays(calendar);

  const maxCount = Math.max(
    ...allDays.map(
      (day) => day.contributionCount
    ),
    1
  );

  const startX = 145;
  const startY = 500;

  const cellSize = 10;
  const gap = 4;
  const step = cellSize + gap;

  let cells = "";

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x =
        startX +
        weekIndex * step;

      const y =
        startY +
        day.weekday * step;

      cells += `
        <rect
          x="${x}"
          y="${y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="2.5"
          fill="${contributionColor(
            day.contributionCount,
            maxCount
          )}">
          <title>${escapeXML(
            day.date
          )}: ${escapeXML(
        day.contributionCount
      )} contributions</title>
        </rect>
      `;
    });
  });

  let monthLabels = "";

  weeks.forEach((week, index) => {
    if (index === 0) {
      return;
    }

    const firstDay = week.firstDay;

    const date =
      new Date(`${firstDay}T00:00:00Z`);

    const previous =
      new Date(
        `${weeks[index - 1].firstDay}T00:00:00Z`
      );

    if (
      date.getUTCMonth() !==
      previous.getUTCMonth()
    ) {
      const monthName =
        date.toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC"
        });

      const x =
        startX +
        index * step;

      monthLabels += `
        <text
          x="${x}"
          y="486"
          fill="#8b949e"
          font-family="monospace"
          font-size="10">
          ${monthName}
        </text>
      `;
    }
  });

  const weekdayLabels = `
    <text x="102" y="510"
      fill="#8b949e"
      font-family="monospace"
      font-size="9">
      M
    </text>

    <text x="102" y="538"
      fill="#8b949e"
      font-family="monospace"
      font-size="9">
      W
    </text>

    <text x="102" y="566"
      fill="#8b949e"
      font-family="monospace"
      font-size="9">
      F
    </text>
  `;

  return `
    ${monthLabels}
    ${weekdayLabels}
    ${cells}
  `;
}

function buildLanguagePanel(languages) {
  if (languages.length === 0) {
    return `
      <text
        x="55"
        y="655"
        fill="#8b949e"
        font-family="monospace"
        font-size="12">
        No language data available
      </text>
    `;
  }

  let output = "";

  const barWidth = 220;

  languages.forEach((item, index) => {
    const y =
      650 + index * 38;

    const width =
      Math.max(
        4,
        (item.percentage / 100) *
          barWidth
      );

    const color =
      languageColor(item.language);

    output += `
      <text
        x="55"
        y="${y}"
        fill="#f0f6fc"
        font-family="monospace"
        font-size="11">
        ${escapeXML(
          item.language
        )}
      </text>

      <rect
        x="165"
        y="${y - 10}"
        width="${barWidth}"
        height="8"
        rx="4"
        fill="#161b22"/>

      <rect
        x="165"
        y="${y - 10}"
        width="${width}"
        height="8"
        rx="4"
        fill="${color}"/>

      <text
        x="400"
        y="${y}"
        fill="#8b949e"
        font-family="monospace"
        font-size="10">
        ${item.percentage.toFixed(
          1
        )}%
      </text>
    `;
  });

  return output;
}

function buildRepositoryPanel(
  repositories
) {
  const filtered =
    repositories
      .filter(
        (repo) =>
          !repo.fork &&
          !repo.archived
      )
      .sort((a, b) => {
        if (
          b.stargazers_count !==
          a.stargazers_count
        ) {
          return (
            b.stargazers_count -
            a.stargazers_count
          );
        }

        return (
          new Date(b.updated_at) -
          new Date(a.updated_at)
        );
      })
      .slice(0, 4);

  let output = "";

  filtered.forEach((repo, index) => {
    const y =
      650 + index * 55;

    const language =
      repo.language || "N/A";

    const stars =
      repo.stargazers_count;

    const name =
      shortRepositoryName(
        repo.name
      );

    output += `
      <text
        x="545"
        y="${y}"
        fill="#58a6ff"
        font-family="monospace"
        font-size="12"
        font-weight="700">
        ${escapeXML(name)}
      </text>

      <text
        x="545"
        y="${y + 18}"
        fill="#8b949e"
        font-family="monospace"
        font-size="9">
        ${escapeXML(
          language
        )} • ★ ${escapeXML(
      stars
    )}
      </text>

      <line
        x1="545"
        y1="${y + 30}"
        x2="1140"
        y2="${y + 30}"
        stroke="#21262d"/>
    `;
  });

  if (filtered.length === 0) {
    output += `
      <text
        x="545"
        y="650"
        fill="#8b949e"
        font-family="monospace"
        font-size="12">
        No public repositories found
      </text>
    `;
  }

  return output;
}

function buildDashboard(
  profile,
  repositories,
  calendar,
  streaks,
  languages
) {
  const totalStars =
    repositories.reduce(
      (sum, repo) =>
        sum + repo.stargazers_count,
      0
    );

  const heatmap =
    buildContributionHeatmap(
      calendar
    );

  const languagePanel =
    buildLanguagePanel(
      languages
    );

  const repositoryPanel =
    buildRepositoryPanel(
      repositories
    );

  return `
<svg
  width="1200"
  height="930"
  viewBox="0 0 1200 930"
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
        stop-opacity="0.22"/>

      <stop
        offset="50%"
        stop-color="#bc8cff"
        stop-opacity="0.12"/>

      <stop
        offset="100%"
        stop-color="#58a6ff"
        stop-opacity="0"/>

    </linearGradient>

    <linearGradient
      id="lineGlow"
      x1="0"
      y1="0"
      x2="1"
      y2="0">

      <stop
        offset="0%"
        stop-color="#58a6ff"
        stop-opacity="0.8"/>

      <stop
        offset="100%"
        stop-color="#39d353"
        stop-opacity="0.05"/>

    </linearGradient>

  </defs>

  <!-- BACKGROUND -->

  <rect
    width="1200"
    height="930"
    rx="24"
    fill="#0d1117"/>

  <rect
    x="1"
    y="1"
    width="1198"
    height="928"
    rx="24"
    fill="none"
    stroke="#30363d"
    stroke-width="2"/>

  <!-- HEADER -->

  <rect
    x="25"
    y="25"
    width="1150"
    height="120"
    rx="18"
    fill="url(#headerGlow)"/>

  <text
    x="55"
    y="68"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="30"
    font-weight="700">
    PRIYANSHU.V
  </text>

  <text
    x="55"
    y="98"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    CSE • DATA SCIENCE • MACHINE LEARNING • SOFTWARE
  </text>

  <text
    x="55"
    y="123"
    fill="#6e7681"
    font-family="monospace"
    font-size="11">
    github.com/priyanshu050307
  </text>

  <circle
    cx="1055"
    cy="67"
    r="7"
    fill="#39d353"/>

  <text
    x="1072"
    y="72"
    fill="#39d353"
    font-family="monospace"
    font-size="12">
    BUILDING
  </text>

  <line
    x1="55"
    y1="145"
    x2="1145"
    y2="145"
    stroke="url(#lineGlow)"/>

  <!-- PROFILE -->

  <text
    x="55"
    y="176"
    fill="#6e7681"
    font-family="monospace"
    font-size="11">
    // GITHUB PROFILE
  </text>

  <!-- STAT CARD 1 -->

  <rect
    x="55"
    y="195"
    width="255"
    height="105"
    rx="14"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="75"
    y="222"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    REPOSITORIES
  </text>

  <text
    x="75"
    y="270"
    fill="#58a6ff"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(
      profile.public_repos
    )}
  </text>

  <!-- STAT CARD 2 -->

  <rect
    x="330"
    y="195"
    width="255"
    height="105"
    rx="14"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="350"
    y="222"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    CONTRIBUTIONS
  </text>

  <text
    x="350"
    y="270"
    fill="#39d353"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(
      calendar.totalContributions
    )}
  </text>

  <!-- STAT CARD 3 -->

  <rect
    x="605"
    y="195"
    width="255"
    height="105"
    rx="14"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="625"
    y="222"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    TOTAL STARS
  </text>

  <text
    x="625"
    y="270"
    fill="#e3b341"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(
      totalStars
    )}
  </text>

  <!-- STAT CARD 4 -->

  <rect
    x="880"
    y="195"
    width="265"
    height="105"
    rx="14"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="900"
    y="222"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    FOLLOWERS
  </text>

  <text
    x="900"
    y="270"
    fill="#f85149"
    font-family="monospace"
    font-size="36"
    font-weight="700">
    ${escapeXML(
      profile.followers
    )}
  </text>

  <text
    x="1015"
    y="271"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    / ${escapeXML(
      profile.following
    )} FOLLOWING
  </text>

  <!-- STREAK -->

  <line
    x1="55"
    y1="330"
    x2="1145"
    y2="330"
    stroke="#21262d"/>

  <text
    x="55"
    y="360"
    fill="#6e7681"
    font-family="monospace"
    font-size="11">
    // CONTRIBUTION INTELLIGENCE
  </text>

  <rect
    x="55"
    y="380"
    width="330"
    height="72"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="75"
    y="405"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    CURRENT STREAK
  </text>

  <text
    x="75"
    y="432"
    fill="#f85149"
    font-family="monospace"
    font-size="21"
    font-weight="700">
    ${escapeXML(
      streaks.currentStreak
    )} DAYS
  </text>

  <rect
    x="405"
    y="380"
    width="330"
    height="72"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="425"
    y="405"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    LONGEST STREAK
  </text>

  <text
    x="425"
    y="432"
    fill="#e3b341"
    font-family="monospace"
    font-size="21"
    font-weight="700">
    ${escapeXML(
      streaks.longestStreak
    )} DAYS
  </text>

  <rect
    x="755"
    y="380"
    width="390"
    height="72"
    rx="12"
    fill="#161b22"
    stroke="#21262d"/>

  <circle
    cx="781"
    cy="416"
    r="6"
    fill="#39d353"/>

  <text
    x="797"
    y="421"
    fill="#39d353"
    font-family="monospace"
    font-size="11">
    SYSTEM ONLINE
  </text>

  <text
    x="955"
    y="421"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    AUTO-GENERATED
  </text>

  <!-- CONTRIBUTION HEATMAP -->

  <text
    x="55"
    y="477"
    fill="#6e7681"
    font-family="monospace"
    font-size="11">
    // CONTRIBUTION MATRIX • LAST 12 MONTHS
  </text>

  ${heatmap}

  <!-- LEGEND -->

  <text
    x="930"
    y="600"
    fill="#8b949e"
    font-family="monospace"
    font-size="9">
    LESS
  </text>

  <rect
    x="965"
    y="591"
    width="10"
    height="10"
    rx="2"
    fill="#161b22"/>

  <rect
    x="981"
    y="591"
    width="10"
    height="10"
    rx="2"
    fill="#0e4429"/>

  <rect
    x="997"
    y="591"
    width="10"
    height="10"
    rx="2"
    fill="#006d32"/>

  <rect
    x="1013"
    y="591"
    width="10"
    height="10"
    rx="2"
    fill="#26a641"/>

  <rect
    x="1029"
    y="591"
    width="10"
    height="10"
    rx="2"
    fill="#39d353"/>

  <text
    x="1047"
    y="600"
    fill="#8b949e"
    font-family="monospace"
    font-size="9">
    MORE
  </text>

  <!-- LOWER PANELS -->

  <line
    x1="55"
    y1="625"
    x2="1145"
    y2="625"
    stroke="#21262d"/>

  <!-- LANGUAGES -->

  <rect
    x="55"
    y="645"
    width="465"
    height="235"
    rx="14"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="80"
    y="676"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="13"
    font-weight="700">
    LANGUAGE ANALYTICS
  </text>

  <text
    x="80"
    y="696"
    fill="#6e7681"
    font-family="monospace"
    font-size="9">
    AGGREGATED FROM REPOSITORIES
  </text>

  ${languagePanel}

  <!-- PROJECTS -->

  <rect
    x="545"
    y="645"
    width="600"
    height="235"
    rx="14"
    fill="#161b22"
    stroke="#21262d"/>

  <text
    x="570"
    y="676"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="13"
    font-weight="700">
    PROJECT HIGHLIGHTS
  </text>

  <text
    x="570"
    y="696"
    fill="#6e7681"
    font-family="monospace"
    font-size="9">
    TOP PUBLIC REPOSITORIES
  </text>

  ${repositoryPanel}

  <!-- FOOTER -->

  <line
    x1="55"
    y1="900"
    x2="1145"
    y2="900"
    stroke="#21262d"/>

  <text
    x="55"
    y="920"
    fill="#39d353"
    font-family="monospace"
    font-size="9">
    &gt; LIVE GITHUB DATA • UPDATED DAILY • PRIYANSHU.V
  </text>

</svg>
`;
}

async function main() {
  console.log(
    `Starting dashboard generation for ${username}...`
  );

  const [
    profile,
    repositories,
    calendar
  ] = await Promise.all([
    fetchProfile(),
    fetchRepositories(),
    fetchContributions()
  ]);

  console.log(
    `Repositories loaded: ${repositories.length}`
  );

  const languages =
    await fetchLanguageStatistics(
      repositories
    );

  const contributionDays =
    flattenContributionDays(
      calendar
    );

  const streaks =
    calculateStreaks(
      contributionDays
    );

  console.log("Dashboard statistics:");
  console.log({
    repositories:
      profile.public_repos,
    followers:
      profile.followers,
    following:
      profile.following,
    contributions:
      calendar.totalContributions,
    currentStreak:
      streaks.currentStreak,
    longestStreak:
      streaks.longestStreak,
    languages:
      languages.map(
        (item) =>
          `${item.language}: ${item.percentage.toFixed(
            1
          )}%`
      )
  });

  const dashboard =
    buildDashboard(
      profile,
      repositories,
      calendar,
      streaks,
      languages
    );

  const outputDir =
    path.join(
      __dirname,
      "..",
      "assets"
    );

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
    `Dashboard successfully written to ${outputPath}`
  );
}

main().catch((error) => {
  console.error(
    "Dashboard generation failed:"
  );

  console.error(error);

  process.exit(1);
});
