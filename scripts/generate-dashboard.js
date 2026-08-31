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
  return githubRequest(`https://api.github.com/users/${username}`);
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
      `Language fetch failed for ${repo.full_name}: ${error.message}`
    );

    return {};
  }
}

async function fetchLanguageStatistics(repositories) {
  const totals = {};

  const languageData = await Promise.all(
    repositories.map(fetchRepositoryLanguages)
  );

  for (const languages of languageData) {
    for (const [language, bytes] of Object.entries(languages)) {
      totals[language] = (totals[language] || 0) + bytes;
    }
  }

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
      percentage: (bytes / totalBytes) * 100
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);
}

async function fetchContributions() {
  const today = new Date();

  const from = new Date(today);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
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
      "GitHub contribution calendar was not returned."
    );
  }

  return calendar;
}

function flattenContributionDays(calendar) {
  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function differenceInDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  return Math.round(
    (end - start) / 86400000
  );
}

function getIndiaDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function calculateStreaks(days) {
  const activeDays = days
    .filter((day) => day.contributionCount > 0)
    .map((day) => day.date)
    .sort();

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

  const today = getIndiaDateString();

  const yesterdayDate = new Date(`${today}T00:00:00Z`);
  yesterdayDate.setUTCDate(
    yesterdayDate.getUTCDate() - 1
  );

  const yesterday = yesterdayDate
    .toISOString()
    .slice(0, 10);

  let anchor = null;

  if (activeDays.includes(today)) {
    anchor = today;
  } else if (activeDays.includes(yesterday)) {
    anchor = yesterday;
  }

  let currentStreak = 0;

  if (anchor) {
    let index = activeDays.indexOf(anchor);
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

function shortName(name, maxLength = 27) {
  if (name.length <= maxLength) {
    return name;
  }

  return `${name.slice(0, maxLength - 3)}...`;
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
    C: "#555555",
    "Jupyter Notebook": "#DA5B0B",
    TeX: "#3D6117"
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
    ...allDays.map(
      (day) => day.contributionCount
    ),
    1
  );

  const startX = 130;
  const startY = 515;

  const cellSize = 11;
  const gap = 4;
  const step = cellSize + gap;

  let cells = "";
  let monthLabels = "";

  calendar.weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x =
        startX + weekIndex * step;

      const y =
        startY + day.weekday * step;

      cells += `
        <rect
          x="${x}"
          y="${y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
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

    if (weekIndex === 0) {
      return;
    }

    const currentDate =
      new Date(`${week.firstDay}T00:00:00Z`);

    const previousDate =
      new Date(
        `${calendar.weeks[
          weekIndex - 1
        ].firstDay}T00:00:00Z`
      );

    if (
      currentDate.getUTCMonth() !==
      previousDate.getUTCMonth()
    ) {
      const monthName =
        currentDate.toLocaleString(
          "en-US",
          {
            month: "short",
            timeZone: "UTC"
          }
        );

      const x =
        startX +
        weekIndex * step;

      monthLabels += `
        <text
          x="${x}"
          y="495"
          fill="#8b949e"
          font-family="monospace"
          font-size="12">
          ${monthName}
        </text>
      `;
    }
  });

  const weekdayLabels = `
    <text
      x="93"
      y="527"
      fill="#8b949e"
      font-family="monospace"
      font-size="10">
      M
    </text>

    <text
      x="93"
      y="557"
      fill="#8b949e"
      font-family="monospace"
      font-size="10">
      W
    </text>

    <text
      x="93"
      y="587"
      fill="#8b949e"
      font-family="monospace"
      font-size="10">
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
        x="85"
        y="745"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
        No language data available
      </text>
    `;
  }

  let output = "";

  const barWidth = 255;

  languages.forEach((item, index) => {
    const y = 745 + index * 35;

    const width =
      Math.max(
        5,
        (item.percentage / 100) *
          barWidth
      );

    const color =
      languageColor(item.language);

    output += `
      <text
        x="85"
        y="${y}"
        fill="#f0f6fc"
        font-family="monospace"
        font-size="13">
        ${escapeXML(item.language)}
      </text>

      <rect
        x="240"
        y="${y - 12}"
        width="${barWidth}"
        height="10"
        rx="5"
        fill="#21262d"/>

      <rect
        x="240"
        y="${y - 12}"
        width="${width}"
        height="10"
        rx="5"
        fill="${color}"/>

      <text
        x="510"
        y="${y}"
        fill="#8b949e"
        font-family="monospace"
        font-size="12">
        ${item.percentage.toFixed(1)}%
      </text>
    `;
  });

  return output;
}

function buildRepositoryPanel(repositories) {
  const selected =
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

  if (selected.length === 0) {
    return `
      <text
        x="610"
        y="745"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
        No public repositories found.
      </text>
    `;
  }

  let output = "";

  selected.forEach((repo, index) => {
    const y =
      745 + index * 52;

    const repoName =
      shortName(repo.name);

    const language =
      repo.language || "N/A";

    output += `
      <text
        x="610"
        y="${y}"
        fill="#58a6ff"
        font-family="monospace"
        font-size="14"
        font-weight="700">
        ${escapeXML(repoName)}
      </text>

      <text
        x="610"
        y="${y + 21}"
        fill="#8b949e"
        font-family="monospace"
        font-size="11">
        ${escapeXML(language)} • ★ ${escapeXML(
      repo.stargazers_count
    )}
      </text>

      <text
        x="955"
        y="${y + 21}"
        fill="#6e7681"
        font-family="monospace"
        font-size="10">
        UPDATED
      </text>

      <line
        x1="610"
        y1="${y + 31}"
        x2="1115"
        y2="${y + 31}"
        stroke="#21262d"/>
    `;
  });

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
    buildContributionHeatmap(calendar);

  const languagePanel =
    buildLanguagePanel(languages);

  const repositoryPanel =
    buildRepositoryPanel(
      repositories
    );

  return `
<svg
  width="1200"
  height="970"
  viewBox="0 0 1200 970"
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
        stop-opacity="0.24"/>

      <stop
        offset="50%"
        stop-color="#bc8cff"
        stop-opacity="0.13"/>

      <stop
        offset="100%"
        stop-color="#58a6ff"
        stop-opacity="0"/>
    </linearGradient>

    <linearGradient
      id="dividerGlow"
      x1="0"
      y1="0"
      x2="1"
      y2="0">

      <stop
        offset="0%"
        stop-color="#58a6ff"
        stop-opacity="0.9"/>

      <stop
        offset="100%"
        stop-color="#39d353"
        stop-opacity="0.04"/>
    </linearGradient>

  </defs>

  <!-- BACKGROUND -->

  <rect
    width="1200"
    height="970"
    rx="24"
    fill="#0d1117"/>

  <rect
    x="1"
    y="1"
    width="1198"
    height="968"
    rx="24"
    fill="none"
    stroke="#30363d"
    stroke-width="2"/>

  <!-- HEADER -->

  <rect
    x="25"
    y="25"
    width="1150"
    height="125"
    rx="18"
    fill="url(#headerGlow)"/>

  <text
    x="58"
    y="72"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="32"
    font-weight="700">
    PRIYANSHU.V
  </text>

  <text
    x="58"
    y="103"
    fill="#8b949e"
    font-family="monospace"
    font-size="15">
    CSE • DATA SCIENCE • MACHINE LEARNING • SOFTWARE
  </text>

  <text
    x="58"
    y="128"
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
    x="1073"
    y="73"
    fill="#39d353"
    font-family="monospace"
    font-size="12">
    BUILDING
  </text>

  <line
    x1="58"
    y1="150"
    x2="1142"
    y2="150"
    stroke="url(#dividerGlow)"/>

  <!-- PROFILE -->

  <text
    x="58"
    y="182"
    fill="#8b949e"
    font-family="monospace"
    font-size="13">
    // GITHUB PROFILE ANALYTICS
  </text>

  <!-- CARD 1 -->

  <rect
    x="58"
    y="200"
    width="255"
    height="108"
    rx="14"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="80"
    y="228"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    REPOSITORIES
  </text>

  <text
    x="80"
    y="277"
    fill="#58a6ff"
    font-family="monospace"
    font-size="38"
    font-weight="700">
    ${escapeXML(profile.public_repos)}
  </text>

  <!-- CARD 2 -->

  <rect
    x="328"
    y="200"
    width="255"
    height="108"
    rx="14"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="350"
    y="228"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    CONTRIBUTIONS
  </text>

  <text
    x="350"
    y="277"
    fill="#39d353"
    font-family="monospace"
    font-size="38"
    font-weight="700">
    ${escapeXML(
      calendar.totalContributions
    )}
  </text>

  <!-- CARD 3 -->

  <rect
    x="598"
    y="200"
    width="255"
    height="108"
    rx="14"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="620"
    y="228"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    TOTAL STARS
  </text>

  <text
    x="620"
    y="277"
    fill="#e3b341"
    font-family="monospace"
    font-size="38"
    font-weight="700">
    ${escapeXML(totalStars)}
  </text>

  <!-- CARD 4 -->

  <rect
    x="868"
    y="200"
    width="274"
    height="108"
    rx="14"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="890"
    y="228"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    FOLLOWERS
  </text>

  <text
    x="890"
    y="277"
    fill="#f85149"
    font-family="monospace"
    font-size="38"
    font-weight="700">
    ${escapeXML(profile.followers)}
  </text>

  <text
    x="1000"
    y="277"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    / ${escapeXML(profile.following)} FOLLOWING
  </text>

  <!-- CONTRIBUTION INTELLIGENCE -->

  <line
    x1="58"
    y1="334"
    x2="1142"
    y2="334"
    stroke="#21262d"/>

  <text
    x="58"
    y="363"
    fill="#8b949e"
    font-family="monospace"
    font-size="13">
    // CONTRIBUTION INTELLIGENCE
  </text>

  <rect
    x="58"
    y="383"
    width="315"
    height="70"
    rx="12"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="80"
    y="409"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    CURRENT STREAK
  </text>

  <text
    x="80"
    y="435"
    fill="#f85149"
    font-family="monospace"
    font-size="21"
    font-weight="700">
    ${escapeXML(
      streaks.currentStreak
    )} DAYS
  </text>

  <rect
    x="398"
    y="383"
    width="315"
    height="70"
    rx="12"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="420"
    y="409"
    fill="#8b949e"
    font-family="monospace"
    font-size="11">
    LONGEST STREAK
  </text>

  <text
    x="420"
    y="435"
    fill="#e3b341"
    font-family="monospace"
    font-size="21"
    font-weight="700">
    ${escapeXML(
      streaks.longestStreak
    )} DAYS
  </text>

  <rect
    x="738"
    y="383"
    width="404"
    height="70"
    rx="12"
    fill="#161b22"
    stroke="#30363d"/>

  <circle
    cx="765"
    cy="417"
    r="6"
    fill="#39d353"/>

  <text
    x="782"
    y="423"
    fill="#39d353"
    font-family="monospace"
    font-size="12">
    SYSTEM ONLINE
  </text>

  <text
    x="970"
    y="423"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    AUTO-GENERATED
  </text>

  <!-- CONTRIBUTION MATRIX -->

  <text
    x="58"
    y="480"
    fill="#8b949e"
    font-family="monospace"
    font-size="13">
    // CONTRIBUTION MATRIX • LAST 12 MONTHS
  </text>

  ${heatmap}

  <!-- CONTRIBUTION LEGEND -->

  <text
    x="920"
    y="615"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    LESS
  </text>

  <rect
    x="960"
    y="604"
    width="12"
    height="12"
    rx="3"
    fill="#161b22"/>

  <rect
    x="978"
    y="604"
    width="12"
    height="12"
    rx="3"
    fill="#0e4429"/>

  <rect
    x="996"
    y="604"
    width="12"
    height="12"
    rx="3"
    fill="#006d32"/>

  <rect
    x="1014"
    y="604"
    width="12"
    height="12"
    rx="3"
    fill="#26a641"/>

  <rect
    x="1032"
    y="604"
    width="12"
    height="12"
    rx="3"
    fill="#39d353"/>

  <text
    x="1053"
    y="615"
    fill="#8b949e"
    font-family="monospace"
    font-size="10">
    MORE
  </text>

  <!-- LOWER PANELS -->

  <line
    x1="58"
    y1="650"
    x2="1142"
    y2="650"
    stroke="#21262d"/>

  <!-- LANGUAGE PANEL -->

  <rect
    x="58"
    y="675"
    width="505"
    height="240"
    rx="14"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="85"
    y="708"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="16"
    font-weight="700">
    LANGUAGE ANALYTICS
  </text>

  <text
    x="85"
    y="730"
    fill="#6e7681"
    font-family="monospace"
    font-size="10">
    AGGREGATED FROM REPOSITORY CODE
  </text>

  ${languagePanel}

  <!-- PROJECT PANEL -->

  <rect
    x="588"
    y="675"
    width="554"
    height="240"
    rx="14"
    fill="#161b22"
    stroke="#30363d"/>

  <text
    x="615"
    y="708"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="16"
    font-weight="700">
    PROJECT HIGHLIGHTS
  </text>

  <text
    x="615"
    y="730"
    fill="#6e7681"
    font-family="monospace"
    font-size="10">
    TOP PUBLIC REPOSITORIES
  </text>

  ${repositoryPanel}

  <!-- FOOTER -->

  <line
    x1="58"
    y1="940"
    x2="1142"
    y2="940"
    stroke="#21262d"/>

  <text
    x="58"
    y="958"
    fill="#39d353"
    font-family="monospace"
    font-size="10">
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
    `Loaded ${repositories.length} repositories.`
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

  console.log({
    repositories:
      profile.public_repos,
    followers:
      profile.followers,
    following:
      profile.following,
    stars:
      repositories.reduce(
        (sum, repo) =>
          sum + repo.stargazers_count,
        0
      ),
    contributions:
      calendar.totalContributions,
    currentStreak:
      streaks.currentStreak,
    longestStreak:
      streaks.longestStreak
  });

  const dashboard =
    buildDashboard(
      profile,
      repositories,
      calendar,
      streaks,
      languages
    );

  const outputDirectory =
    path.join(
      __dirname,
      "..",
      "assets"
    );

  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(
      outputDirectory,
      { recursive: true }
    );
  }

  const outputPath =
    path.join(
      outputDirectory,
      "dashboard.svg"
    );

  fs.writeFileSync(
    outputPath,
    dashboard.trim(),
    "utf8"
  );

  console.log(
    `Dashboard generated successfully: ${outputPath}`
  );
}

main().catch((error) => {
  console.error(
    "Dashboard generation failed:"
  );

  console.error(error);

  process.exit(1);
});
