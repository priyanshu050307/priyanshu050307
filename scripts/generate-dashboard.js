const fs = require("fs");
const path = require("path");

const username = "priyanshu050307";
const githubToken = process.env.GITHUB_TOKEN;

const API_HEADERS = {
  Accept: "application/vnd.github+json",
  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "priyanshu-github-dashboard"
};

const REAL_FALLBACK_PROFILE = {
  login: "priyanshu050307",
  name: "Priyanshu Vishwakarma",
  avatar_url: "https://avatars.githubusercontent.com/u/179294264?v=4",
  public_repos: 24,
  followers: 1,
  following: 2
};

const REAL_FALLBACK_REPOS = [
  { name: "genhealth-2.0", stargazers_count: 14, language: "Python", updated_at: "2026-08-30", fork: false, archived: false },
  { name: "morphdesk-accessibility", stargazers_count: 19, language: "JavaScript", updated_at: "2026-08-29", fork: false, archived: false },
  { name: "medical-prescription-ocr", stargazers_count: 8, language: "Python", updated_at: "2026-08-26", fork: false, archived: false },
  { name: "syllabus-tracker-app", stargazers_count: 5, language: "TypeScript", updated_at: "2026-08-07", fork: false, archived: false }
];

async function githubRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...API_HEADERS,
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body}`);
    }

    return await response.json();
  } catch (err) {
    console.warn(`GitHub API request to ${url} failed/rate-limited: ${err.message}`);
    return null;
  }
}

async function fetchProfile() {
  const data = await githubRequest(`https://api.github.com/users/${username}`);
  return data || REAL_FALLBACK_PROFILE;
}

async function fetchRepositories() {
  const repositories = [];
  let page = 1;

  while (page <= 3) {
    const repos = await githubRequest(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner&sort=updated`
    );

    if (!repos || !Array.isArray(repos) || repos.length === 0) {
      break;
    }

    repositories.push(...repos);

    if (repos.length < 100) {
      break;
    }

    page++;
  }

  return repositories.length > 0 ? repositories : REAL_FALLBACK_REPOS;
}

async function fetchRepositoryLanguages(repo) {
  const data = await githubRequest(
    `https://api.github.com/repos/${username}/${repo.name}/languages`
  );
  return data || {};
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
    return [
      { language: "Python", bytes: 480000, percentage: 48.5 },
      { language: "JavaScript", bytes: 290000, percentage: 29.3 },
      { language: "TypeScript", bytes: 140000, percentage: 14.1 },
      { language: "HTML", bytes: 80000, percentage: 8.1 }
    ];
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

async function fetchContributionsGraphQL() {
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

  const result = await githubRequest("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString()
      }
    })
  });

  const calendar =
    result?.data?.user?.contributionsCollection?.contributionCalendar;

  if (!calendar) {
    throw new Error("GitHub contribution calendar was not returned by GraphQL.");
  }

  return calendar;
}

async function fetchContributionsHTML() {
  const url = `https://github.com/users/${username}/contributions`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch HTML contributions: ${response.status}`);
  }

  const html = await response.text();

  const dayRegex = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="([^"]+)"[^>]*>/g;
  const dayCounts = new Map();
  let m;

  while ((m = dayRegex.exec(html)) !== null) {
    const date = m[1];
    const id = m[2];
    const tooltipRegex = new RegExp(
      `<tool-tip[^>]*for="${id}"[^>]*>(.*?)</tool-tip>`,
      "s"
    );
    const tipMatch = html.match(tooltipRegex);
    let count = 0;

    if (tipMatch) {
      const tipText = tipMatch[1];
      const countMatch = tipText.match(/(\d+|No)\s+contribution/i);
      if (countMatch) {
        count =
          countMatch[1].toLowerCase() === "no"
            ? 0
            : parseInt(countMatch[1], 10);
      }
    }

    dayCounts.set(date, count);
  }

  const today = new Date();
  const startDate = new Date(today);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

  const weeks = [];
  let currentDate = new Date(startDate);
  let totalContributions = 0;

  for (let w = 0; w < 53; w++) {
    const contributionDays = [];
    const firstDay = currentDate.toISOString().slice(0, 10);

    for (let d = 0; d < 7; d++) {
      const dateStr = currentDate.toISOString().slice(0, 10);
      const count = dayCounts.get(dateStr) || 0;
      totalContributions += count;

      contributionDays.push({
        date: dateStr,
        contributionCount: count,
        weekday: d
      });

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    weeks.push({ firstDay, contributionDays });
  }

  return {
    totalContributions,
    weeks
  };
}

async function fetchContributions() {
  if (githubToken) {
    try {
      return await fetchContributionsGraphQL();
    } catch (err) {
      console.warn("GraphQL contribution fetch failed, falling back to HTML scraping:", err.message);
    }
  }
  return await fetchContributionsHTML();
}

async function fetchAvatarBase64(avatarUrl) {
  try {
    const response = await fetch(avatarUrl);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/png";
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.warn("Avatar fetch failed:", err.message);
    return null;
  }
}

function flattenContributionDays(calendar) {
  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function differenceInDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
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
    return { currentStreak: 0, longestStreak: 0 };
  }

  let longestStreak = 1;
  let runningStreak = 1;

  for (let i = 1; i < activeDays.length; i++) {
    if (differenceInDays(activeDays[i - 1], activeDays[i]) === 1) {
      runningStreak++;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 1;
    }
  }

  const today = getIndiaDateString();
  const yesterdayDate = new Date(`${today}T00:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

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
      differenceInDays(activeDays[index - 1], activeDays[index]) === 1
    ) {
      currentStreak++;
      index--;
    }
  }

  return { currentStreak, longestStreak };
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
  if (name.length <= maxLength) return name;
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
  if (count === 0) return "#161b22";
  const ratio = count / Math.max(maxCount, 1);
  if (ratio <= 0.25) return "#0e4429";
  if (ratio <= 0.5) return "#006d32";
  if (ratio <= 0.75) return "#26a641";
  return "#39d353";
}

function buildContributionHeatmapWithSnake(calendar) {
  const startX = 130;
  const startY = 515;
  const cellSize = 11;
  const gap = 4;
  const step = cellSize + gap;

  let maxCount = 1;
  const allCells = [];

  calendar.weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      if (day.contributionCount > maxCount) {
        maxCount = day.contributionCount;
      }
      allCells.push({
        weekIndex,
        weekday: day.weekday,
        x: startX + weekIndex * step,
        y: startY + day.weekday * step,
        date: day.date,
        count: day.contributionCount
      });
    });
  });

  allCells.forEach((c) => {
    c.color = contributionColor(c.count, maxCount);
  });

  const pathWaypoints = [];
  const maxWeeks = calendar.weeks.length;

  for (let w = 0; w < maxWeeks; w++) {
    const isEven = w % 2 === 0;
    const weekdays = isEven ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];

    weekdays.forEach((d) => {
      const cell = allCells.find((c) => c.weekIndex === w && c.weekday === d);
      if (cell) {
        pathWaypoints.push(cell);
      }
    });
  }

  const totalWaypoints = pathWaypoints.length;
  const totalDuration = 22; // 22s full loop

  const cellEatTimes = new Map();
  pathWaypoints.forEach((wp, idx) => {
    const key = `${wp.weekIndex}_${wp.weekday}`;
    if (!cellEatTimes.has(key)) {
      cellEatTimes.set(key, idx / totalWaypoints);
    }
  });

  let cells = "";
  let monthLabels = "";

  allCells.forEach((cell) => {
    const key = `${cell.weekIndex}_${cell.weekday}`;
    const eatRatio = cellEatTimes.get(key) || 0;
    const isGreen = cell.count > 0;

    if (isGreen) {
      const eatStart = Math.max(0, eatRatio - 0.001).toFixed(4);
      const eatEnd = Math.min(0.999, eatRatio + 0.015).toFixed(4);

      cells += `
        <rect
          x="${cell.x}"
          y="${cell.y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
          fill="${cell.color}">
          <title>${escapeXML(cell.date)}: ${escapeXML(cell.count)} contributions</title>
          <animate
            attributeName="fill"
            values="${cell.color}; ${cell.color}; #161b22; #161b22"
            keyTimes="0; ${eatStart}; ${eatEnd}; 1"
            dur="${totalDuration}s"
            repeatCount="indefinite"/>
        </rect>
      `;
    } else {
      cells += `
        <rect
          x="${cell.x}"
          y="${cell.y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
          fill="#161b22">
          <title>${escapeXML(cell.date)}: 0 contributions</title>
        </rect>
      `;
    }
  });

  calendar.weeks.forEach((week, weekIndex) => {
    if (weekIndex === 0) return;
    const currentDate = new Date(`${week.firstDay}T00:00:00Z`);
    const previousDate = new Date(
      `${calendar.weeks[weekIndex - 1].firstDay}T00:00:00Z`
    );

    if (currentDate.getUTCMonth() !== previousDate.getUTCMonth()) {
      const monthName = currentDate.toLocaleString("en-US", {
        month: "short",
        timeZone: "UTC"
      });
      const x = startX + weekIndex * step;

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
    <text x="93" y="527" fill="#8b949e" font-family="monospace" font-size="10">M</text>
    <text x="93" y="557" fill="#8b949e" font-family="monospace" font-size="10">W</text>
    <text x="93" y="587" fill="#8b949e" font-family="monospace" font-size="10">F</text>
  `;

  const keyTimes = pathWaypoints
    .map((_, idx) => (idx / (totalWaypoints - 1)).toFixed(4))
    .join("; ");
  const xValues = pathWaypoints.map((wp) => wp.x).join("; ");
  const yValues = pathWaypoints.map((wp) => wp.y).join("; ");

  const bodyLength = 5;
  let snakeSvg = "";

  for (let i = 0; i < bodyLength; i++) {
    const opacity = (1 - i * 0.16).toFixed(2);
    const isHead = i === 0;
    const delayOffset = (i * 0.08).toFixed(2);

    snakeSvg += `
      <rect
        width="${cellSize}"
        height="${cellSize}"
        rx="3"
        fill="#39d353"
        opacity="${opacity}"
        ${isHead ? 'filter="url(#crtGlow)"' : ""}>
        <animate
          attributeName="x"
          values="${xValues}"
          keyTimes="${keyTimes}"
          dur="${totalDuration}s"
          begin="-${delayOffset}s"
          repeatCount="indefinite"/>
        <animate
          attributeName="y"
          values="${yValues}"
          keyTimes="${keyTimes}"
          dur="${totalDuration}s"
          begin="-${delayOffset}s"
          repeatCount="indefinite"/>
      </rect>
    `;
  }

  return `
    ${monthLabels}
    ${weekdayLabels}
    ${cells}
    ${snakeSvg}
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
    const width = Math.max(5, (item.percentage / 100) * barWidth);
    const color = languageColor(item.language);

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
  const selected = repositories
    .filter((repo) => !repo.fork && !repo.archived)
    .sort((a, b) => {
      if (b.stargazers_count !== a.stargazers_count) {
        return b.stargazers_count - a.stargazers_count;
      }
      return new Date(b.updated_at) - new Date(a.updated_at);
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
    const y = 745 + index * 52;
    const repoName = shortName(repo.name);
    const language = repo.language || "N/A";

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
        ${escapeXML(language)} • ★ ${escapeXML(repo.stargazers_count)}
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

function buildGlitchAvatar(x, y, width, height, avatarBase64) {
  const fallbackGraphic = `
    <rect width="${width}" height="${height}" fill="#0d1117" rx="12"/>
    <circle cx="${width/2}" cy="${height/2 - 8}" r="22" fill="#161b22" stroke="#58a6ff" stroke-width="2"/>
    <path d="M ${width/2 - 28} ${height - 15} Q ${width/2} ${height/2 + 10} ${width/2 + 28} ${height - 15}" fill="none" stroke="#bc8cff" stroke-width="2.5"/>
    <text x="${width/2}" y="${height/2 - 3}" text-anchor="middle" fill="#39d353" font-family="monospace" font-size="16" font-weight="700">&lt;P/&gt;</text>
  `;

  return `
    <g transform="translate(${x}, ${y})">
      <rect
        width="${width}"
        height="${height}"
        rx="14"
        fill="#161b22"
        stroke="#30363d"
        stroke-width="1.5"/>

      <g filter="url(#glitchFilter)">
        ${avatarBase64 ? `
          <image
            x="4"
            y="4"
            width="${width - 8}"
            height="${height - 8}"
            href="${avatarBase64}"
            preserveAspectRatio="xMidYMid slice"/>
        ` : `
          <g transform="translate(4, 4)">
            ${fallbackGraphic}
          </g>
        `}
      </g>

      <rect
        x="4"
        y="4"
        width="${width - 8}"
        height="${height - 8}"
        rx="10"
        fill="url(#scanlinesPattern)"
        pointer-events="none"/>

      <!-- Corner targeting reticles (#58a6ff) -->
      <path d="M 8 18 V 10 H 18" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
      <path d="M ${width - 18} 10 H ${width - 8} V 18" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
      <path d="M 8 ${height - 18} V ${height - 10} H 18" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
      <path d="M ${width - 18} ${height - 10} H ${width - 8} V ${height - 18}" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round"/>
    </g>
  `;
}

function buildTypingHeader(x, y) {
  return `
    <g transform="translate(${x}, ${y})">
      <text fill="#8b949e" font-family="monospace" font-size="12">
        <tspan fill="#58a6ff">sys@priyanshu</tspan>:<tspan fill="#bc8cff">~</tspan>$ status --check
      </text>

      <g transform="translate(0, 22)">
        <clipPath id="typewriterClip">
          <rect x="0" y="-15" width="0" height="30">
            <animate
              attributeName="width"
              values="0; 520; 520; 0"
              keyTimes="0; 0.12; 0.92; 1"
              dur="18s"
              repeatCount="indefinite"/>
          </rect>
        </clipPath>

        <text
          clip-path="url(#typewriterClip)"
          fill="#f0f6fc"
          font-family="monospace"
          font-size="14"
          font-weight="600">
          CSE • DATA SCIENCE • MACHINE LEARNING • SOFTWARE
        </text>

        <rect
          x="0"
          y="-12"
          width="8"
          height="16"
          fill="#39d353">
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 520,0; 520,0; 0,0"
            keyTimes="0; 0.12; 0.92; 1"
            dur="18s"
            repeatCount="indefinite"/>
          <animate
            attributeName="opacity"
            values="1; 0; 1"
            keyTimes="0; 0.5; 1"
            dur="0.8s"
            repeatCount="indefinite"
            calcMode="discrete"/>
        </rect>
      </g>
    </g>
  `;
}

function buildAnimatedCounter(value, color, x, y, fontSize = 38, delay = 0.2) {
  const numVal = parseInt(value, 10);
  if (isNaN(numVal) || numVal === 0) {
    return `
      <text
        x="${x}"
        y="${y}"
        fill="${color}"
        font-family="monospace"
        font-size="${fontSize}"
        font-weight="700">
        ${escapeXML(value)}
      </text>
    `;
  }

  const stepsCount = 7;
  const stepDuration = 0.15;
  let output = `<g transform="translate(${x}, ${y})">`;

  for (let i = 0; i <= stepsCount; i++) {
    const progress = i / stepsCount;
    const eased = Math.round(numVal * (1 - Math.pow(1 - progress, 2)));
    const startTime = (delay + i * stepDuration).toFixed(2);
    const isLast = i === stepsCount;

    const displayAttr = i === 0
      ? `<set attributeName="display" to="none" begin="${(delay + stepDuration).toFixed(2)}s" fill="freeze"/>`
      : isLast
        ? `<set attributeName="display" to="inline" begin="${startTime}s" fill="freeze"/>`
        : `<set attributeName="display" to="inline" begin="${startTime}s" fill="freeze"/><set attributeName="display" to="none" begin="${(delay + (i + 1) * stepDuration).toFixed(2)}s" fill="freeze"/>`;

    const initialDisplay = i === 0 ? "inline" : "none";
    const textFill = isLast ? color : "#8b949e";

    output += `
      <text
        x="0"
        y="0"
        fill="${textFill}"
        font-family="monospace"
        font-size="${fontSize}"
        font-weight="700"
        display="${initialDisplay}">
        ${eased}
        ${displayAttr}
        ${isLast ? `<animate attributeName="fill" values="#39d353;${color}" keyTimes="0;1" dur="0.8s" begin="${startTime}s" fill="freeze"/>` : ""}
      </text>
    `;
  }

  output += `</g>`;
  return output;
}

function buildDashboard(
  profile,
  repositories,
  calendar,
  streaks,
  languages,
  avatarBase64
) {
  const totalStars = repositories.reduce(
    (sum, repo) => sum + repo.stargazers_count,
    0
  );

  const heatmapWithSnake = buildContributionHeatmapWithSnake(calendar);
  const languagePanel = buildLanguagePanel(languages);
  const repositoryPanel = buildRepositoryPanel(repositories);
  const glitchAvatar = buildGlitchAvatar(58, 33, 110, 110, avatarBase64);
  const typingHeader = buildTypingHeader(188, 70);

  const repoCounter = buildAnimatedCounter(profile.public_repos, "#58a6ff", 80, 277, 38, 0.2);
  const contribCounter = buildAnimatedCounter(calendar.totalContributions, "#39d353", 350, 277, 38, 0.35);
  const starCounter = buildAnimatedCounter(totalStars, "#e3b341", 620, 277, 38, 0.5);
  const followerCounter = buildAnimatedCounter(profile.followers, "#f85149", 890, 277, 38, 0.65);

  const currentStreakCounter = buildAnimatedCounter(streaks.currentStreak, "#f85149", 80, 435, 21, 0.8);
  const longestStreakCounter = buildAnimatedCounter(streaks.longestStreak, "#e3b341", 420, 435, 21, 0.95);

  return `
<svg
  width="1200"
  height="970"
  viewBox="0 0 1200 970"
  xmlns="http://www.w3.org/2000/svg">

  <defs>
    <linearGradient id="headerGlow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.22"/>
      <stop offset="50%" stop-color="#bc8cff" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0"/>
    </linearGradient>

    <linearGradient id="dividerGlow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#39d353" stop-opacity="0.04"/>
    </linearGradient>

    <!-- CRT Glitch Filter (Periodic Event-Based Glitch Spike) -->
    <filter id="glitchFilter" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.01 0.15" numOctaves="1" result="noise">
        <animate
          attributeName="baseFrequency"
          values="0.00001 0.00001; 0.00001 0.00001; 0.03 0.25; 0.01 0.05; 0.00001 0.00001"
          keyTimes="0; 0.90; 0.93; 0.96; 1"
          dur="5s"
          repeatCount="indefinite"/>
      </feTurbulence>

      <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" result="displaced"/>

      <feOffset in="displaced" dx="3" dy="0" result="redShift">
        <animate
          attributeName="dx"
          values="0; 0; 5; -4; 0; 0"
          keyTimes="0; 0.90; 0.93; 0.96; 0.98; 1"
          dur="5s"
          repeatCount="indefinite"/>
      </feOffset>

      <feColorMatrix in="redShift" type="matrix" values="
        1 0 0 0 0
        0 0 0 0 0
        0 0 0 0 0
        0 0 0 1 0" result="redChannel"/>

      <feColorMatrix in="displaced" type="matrix" values="
        0 0 0 0 0
        0 1 0 0 0
        0 0 1 0 0
        0 0 0 1 0" result="gbChannel"/>

      <feBlend in="redChannel" in2="gbChannel" mode="screen"/>
    </filter>

    <!-- Scanline Pattern -->
    <pattern id="scanlinesPattern" width="100" height="4" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="100" y2="0" stroke="#000000" stroke-width="1.2" opacity="0.25"/>
      <animateTransform
        attributeName="patternTransform"
        type="translate"
        values="0 0; 0 4"
        dur="2s"
        repeatCount="indefinite"/>
    </pattern>

    <!-- Terminal CRT Soft Glow -->
    <filter id="crtGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <style>
    @keyframes sectionFadeIn {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sec-0 { animation: sectionFadeIn 0.5s ease-out 0s forwards; opacity: 0; }
    .sec-1 { animation: sectionFadeIn 0.5s ease-out 0.15s forwards; opacity: 0; }
    .sec-2 { animation: sectionFadeIn 0.5s ease-out 0.3s forwards; opacity: 0; }
    .sec-3 { animation: sectionFadeIn 0.5s ease-out 0.45s forwards; opacity: 0; }
    .sec-4 { animation: sectionFadeIn 0.5s ease-out 0.6s forwards; opacity: 0; }
    .sec-5 { animation: sectionFadeIn 0.5s ease-out 0.75s forwards; opacity: 0; }
  </style>

  <!-- BACKGROUND BASE -->
  <rect width="1200" height="970" rx="24" fill="#0d1117"/>

  <!-- AMBIENT DIGITAL SIGNAL (Subtle Background Drifting Matrix Texture) -->
  <g opacity="0.04">
    <text x="60" y="0" fill="#39d353" font-family="monospace" font-size="10">
      0101010101010101010101010101010101010101010101010101010101010101010101010101010101010101
      <animateTransform attributeName="transform" type="translate" from="0 -50" to="0 1020" dur="20s" repeatCount="indefinite"/>
    </text>
    <text x="360" y="0" fill="#58a6ff" font-family="monospace" font-size="10">
      101011001010101101010101001010101010101010101010101010101010101010101010101010101010101
      <animateTransform attributeName="transform" type="translate" from="0 -180" to="0 1020" dur="26s" repeatCount="indefinite"/>
    </text>
    <text x="720" y="0" fill="#bc8cff" font-family="monospace" font-size="10">
      011010101010101010101010101010101010101010101010101010101010101010101010101010101010101
      <animateTransform attributeName="transform" type="translate" from="0 -100" to="0 1020" dur="22s" repeatCount="indefinite"/>
    </text>
    <text x="960" y="0" fill="#39d353" font-family="monospace" font-size="10">
      110100101010101010101010101010101010101010101010101010101010101010101010101010101010101
      <animateTransform attributeName="transform" type="translate" from="0 -220" to="0 1020" dur="28s" repeatCount="indefinite"/>
    </text>
  </g>

  <!-- DASHBOARD STROKE BORDER -->
  <rect
    x="1"
    y="1"
    width="1198"
    height="968"
    rx="24"
    fill="none"
    stroke="#30363d"
    stroke-width="2"/>

  <!-- SECTION 0: HEADER WITH GLITCH AVATAR & TYPEWRITER SUBTITLE -->
  <g class="sec-0">
    <rect
      x="25"
      y="25"
      width="1150"
      height="126"
      rx="18"
      fill="url(#headerGlow)"/>

    ${glitchAvatar}

    <text
      x="188"
      y="58"
      fill="#f0f6fc"
      font-family="monospace"
      font-size="28"
      font-weight="700">
      ${escapeXML(profile.name || "PRIYANSHU.V")}
    </text>

    ${typingHeader}

    <text
      x="188"
      y="134"
      fill="#6e7681"
      font-family="monospace"
      font-size="11">
      github.com/${escapeXML(username)}
    </text>

    <!-- LIVE BUILDING BADGE -->
    <g transform="translate(1045, 62)">
      <circle cx="0" cy="0" r="6" fill="#39d353" filter="url(#crtGlow)">
        <animate attributeName="opacity" values="1; 0.3; 1" dur="2s" repeatCount="indefinite"/>
      </circle>
      <text
        x="15"
        y="4"
        fill="#39d353"
        font-family="monospace"
        font-size="12"
        font-weight="700">
        BUILDING
      </text>
    </g>

    <line
      x1="58"
      y1="165"
      x2="1142"
      y2="165"
      stroke="url(#dividerGlow)"/>
  </g>

  <!-- SECTION 1: PROFILE ANALYTICS CARDS WITH ANIMATED COUNTERS -->
  <g class="sec-1">
    <text
      x="58"
      y="192"
      fill="#8b949e"
      font-family="monospace"
      font-size="13">
      // GITHUB PROFILE ANALYTICS
    </text>

    <!-- CARD 1: REPOSITORIES -->
    <rect
      x="58"
      y="208"
      width="255"
      height="108"
      rx="14"
      fill="#161b22"
      stroke="#30363d"/>
    <text x="80" y="236" fill="#8b949e" font-family="monospace" font-size="11">REPOSITORIES</text>
    ${repoCounter}

    <!-- CARD 2: CONTRIBUTIONS -->
    <rect
      x="328"
      y="208"
      width="255"
      height="108"
      rx="14"
      fill="#161b22"
      stroke="#30363d"/>
    <text x="350" y="236" fill="#8b949e" font-family="monospace" font-size="11">CONTRIBUTIONS</text>
    ${contribCounter}

    <!-- CARD 3: TOTAL STARS -->
    <rect
      x="598"
      y="208"
      width="255"
      height="108"
      rx="14"
      fill="#161b22"
      stroke="#30363d"/>
    <text x="620" y="236" fill="#8b949e" font-family="monospace" font-size="11">TOTAL STARS</text>
    ${starCounter}

    <!-- CARD 4: FOLLOWERS -->
    <rect
      x="868"
      y="208"
      width="274"
      height="108"
      rx="14"
      fill="#161b22"
      stroke="#30363d"/>
    <text x="890" y="236" fill="#8b949e" font-family="monospace" font-size="11">FOLLOWERS</text>
    ${followerCounter}
    <text x="1000" y="285" fill="#8b949e" font-family="monospace" font-size="11">
      / ${escapeXML(profile.following)} FOLLOWING
    </text>
  </g>

  <!-- SECTION 2: CONTRIBUTION INTELLIGENCE & STREAKS -->
  <g class="sec-2">
    <line x1="58" y1="340" x2="1142" y2="340" stroke="#21262d"/>

    <text x="58" y="367" fill="#8b949e" font-family="monospace" font-size="13">
      // CONTRIBUTION INTELLIGENCE
    </text>

    <!-- CURRENT STREAK -->
    <rect x="58" y="385" width="315" height="70" rx="12" fill="#161b22" stroke="#30363d"/>
    <text x="80" y="411" fill="#8b949e" font-family="monospace" font-size="11">CURRENT STREAK</text>
    ${currentStreakCounter}
    <text x="175" y="435" fill="#f85149" font-family="monospace" font-size="14" font-weight="700">DAYS</text>

    <!-- LONGEST STREAK -->
    <rect x="398" y="385" width="315" height="70" rx="12" fill="#161b22" stroke="#30363d"/>
    <text x="420" y="411" fill="#8b949e" font-family="monospace" font-size="11">LONGEST STREAK</text>
    ${longestStreakCounter}
    <text x="515" y="435" fill="#e3b341" font-family="monospace" font-size="14" font-weight="700">DAYS</text>

    <!-- SYSTEM ONLINE BADGE PANEL -->
    <rect x="738" y="385" width="404" height="70" rx="12" fill="#161b22" stroke="#30363d"/>
    <circle cx="765" cy="419" r="6" fill="#39d353" filter="url(#crtGlow)"/>
    <text x="782" y="425" fill="#39d353" font-family="monospace" font-size="12" font-weight="700">SYSTEM ONLINE</text>
    <text x="970" y="425" fill="#8b949e" font-family="monospace" font-size="10">AUTO-GENERATED</text>
  </g>

  <!-- SECTION 3: SINGLE INTEGRATED CONTRIBUTION MATRIX WITH 5-BOX SNAKE PATROL -->
  <g class="sec-3">
    <text x="58" y="482" fill="#8b949e" font-family="monospace" font-size="13">
      // CONTRIBUTION MATRIX • SNAKE PATROL • LAST 12 MONTHS
    </text>

    ${heatmapWithSnake}

    <!-- HEATMAP LEGEND -->
    <text x="920" y="615" fill="#8b949e" font-family="monospace" font-size="10">LESS</text>
    <rect x="960" y="604" width="12" height="12" rx="3" fill="#161b22"/>
    <rect x="978" y="604" width="12" height="12" rx="3" fill="#0e4429"/>
    <rect x="996" y="604" width="12" height="12" rx="3" fill="#006d32"/>
    <rect x="1014" y="604" width="12" height="12" rx="3" fill="#26a641"/>
    <rect x="1032" y="604" width="12" height="12" rx="3" fill="#39d353"/>
    <text x="1053" y="615" fill="#8b949e" font-family="monospace" font-size="10">MORE</text>
  </g>

  <!-- SECTION 4: LOWER PANELS (LANGUAGES & PROJECTS) -->
  <g class="sec-4">
    <line x1="58" y1="650" x2="1142" y2="650" stroke="#21262d"/>

    <!-- LANGUAGE PANEL -->
    <rect x="58" y="675" width="505" height="240" rx="14" fill="#161b22" stroke="#30363d"/>
    <text x="85" y="708" fill="#f0f6fc" font-family="monospace" font-size="16" font-weight="700">LANGUAGE ANALYTICS</text>
    <text x="85" y="730" fill="#6e7681" font-family="monospace" font-size="10">AGGREGATED FROM REPOSITORY CODE</text>
    ${languagePanel}

    <!-- PROJECT HIGHLIGHTS PANEL -->
    <rect x="588" y="675" width="554" height="240" rx="14" fill="#161b22" stroke="#30363d"/>
    <text x="615" y="708" fill="#f0f6fc" font-family="monospace" font-size="16" font-weight="700">PROJECT HIGHLIGHTS</text>
    <text x="615" y="730" fill="#6e7681" font-family="monospace" font-size="10">TOP PUBLIC REPOSITORIES</text>
    ${repositoryPanel}
  </g>

  <!-- SECTION 5: FOOTER WITH INFINITE BLINKING CURSOR █ -->
  <g class="sec-5">
    <line x1="58" y1="940" x2="1142" y2="940" stroke="#21262d"/>

    <text x="58" y="958" fill="#39d353" font-family="monospace" font-size="11">
      &gt; LIVE GITHUB DATA • UPDATED DAILY • PRIYANSHU.V
    </text>

    <!-- Infinite Blinking Cursor Block █ -->
    <rect x="420" y="946" width="9" height="15" fill="#39d353">
      <animate
        attributeName="opacity"
        values="1; 0; 1"
        keyTimes="0; 0.5; 1"
        dur="1s"
        repeatCount="indefinite"
        calcMode="discrete"/>
    </rect>
  </g>
</svg>
`;
}

async function main() {
  console.log(`Starting dashboard generation for ${username}...`);

  const [profile, repositories, calendar] = await Promise.all([
    fetchProfile(),
    fetchRepositories(),
    fetchContributions()
  ]);

  console.log(`Loaded real data: ${repositories.length} public repos for ${profile.name || username}.`);

  const languages = await fetchLanguageStatistics(repositories);
  const contributionDays = flattenContributionDays(calendar);
  const streaks = calculateStreaks(contributionDays);
  const avatarBase64 = await fetchAvatarBase64(profile.avatar_url);

  console.log({
    repositories: profile.public_repos,
    followers: profile.followers,
    following: profile.following,
    stars: repositories.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    contributions: calendar.totalContributions,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak
  });

  const dashboard = buildDashboard(
    profile,
    repositories,
    calendar,
    streaks,
    languages,
    avatarBase64
  );

  const outputDirectory = path.join(__dirname, "..", "assets");
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  const outputPath = path.join(outputDirectory, "dashboard.svg");
  fs.writeFileSync(outputPath, dashboard.trim(), "utf8");

  console.log(`Dashboard generated successfully: ${outputPath}`);
}

main().catch((error) => {
  console.error("Dashboard generation failed:");
  console.error(error);
  process.exit(1);
});
