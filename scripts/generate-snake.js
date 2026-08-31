const fs = require("fs");
const path = require("path");

const username = "priyanshu050307";
const githubToken = process.env.GITHUB_TOKEN;

const API_HEADERS = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${githubToken}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "priyanshu-snake-generator"
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

function generateMockCalendar() {
  const weeks = [];
  const today = new Date();
  const startDate = new Date(today);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

  let currentDate = new Date(startDate);
  let totalContributions = 0;

  for (let w = 0; w < 53; w++) {
    const contributionDays = [];
    const firstDay = currentDate.toISOString().slice(0, 10);

    for (let d = 0; d < 7; d++) {
      const dateStr = currentDate.toISOString().slice(0, 10);
      const rand = Math.random();
      let count = 0;
      if (rand > 0.45) count = Math.floor(Math.random() * 5) + 1;
      if (rand > 0.82) count = Math.floor(Math.random() * 12) + 6;

      totalContributions += count;
      contributionDays.push({
        date: dateStr,
        contributionCount: count,
        weekday: d
      });

      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    weeks.push({
      firstDay,
      contributionDays
    });
  }

  return {
    totalContributions,
    weeks
  };
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

  if (result.errors) {
    throw new Error(
      `GitHub GraphQL error:\n${JSON.stringify(result.errors, null, 2)}`
    );
  }

  const calendar =
    result.data?.user?.contributionsCollection?.contributionCalendar;

  if (!calendar) {
    throw new Error("GitHub contribution calendar was not returned.");
  }

  return calendar;
}

function contributionColor(count, maxCount) {
  if (count === 0) return "#161b22";
  const ratio = count / Math.max(maxCount, 1);
  if (ratio <= 0.25) return "#0e4429";
  if (ratio <= 0.5) return "#006d32";
  if (ratio <= 0.75) return "#26a641";
  return "#39d353";
}

function buildSnakeSVG(calendar) {
  const startX = 60;
  const startY = 75;
  const cellSize = 11;
  const gap = 4;
  const step = cellSize + gap;

  // Flatten days & identify active cells
  const allCells = [];
  let maxCount = 1;

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
        count: day.contributionCount,
        color: contributionColor(day.contributionCount, 1) // updated later
      });
    });
  });

  allCells.forEach((c) => {
    c.color = contributionColor(c.count, maxCount);
  });

  // Serpent path generator through matrix
  // Traverse serpentine column by column: even columns down (0->6), odd columns up (6->0)
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
  const totalDuration = 22; // 22 seconds full traversal

  // Map each cell to its primary "eat" timestamp ratio in [0, 1]
  const cellEatTimes = new Map();
  pathWaypoints.forEach((wp, idx) => {
    const key = `${wp.weekIndex}_${wp.weekday}`;
    if (!cellEatTimes.has(key)) {
      cellEatTimes.set(key, idx / totalWaypoints);
    }
  });

  // Build grid cells with SMIL eaten-cell drain transition
  let gridSvg = "";
  allCells.forEach((cell) => {
    const key = `${cell.weekIndex}_${cell.weekday}`;
    const eatRatio = cellEatTimes.get(key) || 0;
    const isGreen = cell.count > 0;

    if (isGreen) {
      const eatStart = Math.max(0, eatRatio - 0.001).toFixed(4);
      const eatEnd = Math.min(0.999, eatRatio + 0.015).toFixed(4);

      gridSvg += `
        <rect
          x="${cell.x}"
          y="${cell.y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
          fill="${cell.color}">
          <animate
            attributeName="fill"
            values="${cell.color}; ${cell.color}; #161b22; #161b22"
            keyTimes="0; ${eatStart}; ${eatEnd}; 1"
            dur="${totalDuration}s"
            repeatCount="indefinite"/>
        </rect>
      `;
    } else {
      gridSvg += `
        <rect
          x="${cell.x}"
          y="${cell.y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="3"
          fill="#161b22"/>
      `;
    }
  });

  // Generate Snake Motion path String (d attribute) & KeyTimes
  const pathD = pathWaypoints.reduce((acc, wp, idx) => {
    const prefix = idx === 0 ? "M" : "L";
    return `${acc} ${prefix} ${wp.x + cellSize / 2} ${wp.y + cellSize / 2}`;
  }, "");

  // Generate keyTimes array for keyframe interpolation
  const keyTimes = pathWaypoints
    .map((_, idx) => (idx / (totalWaypoints - 1)).toFixed(4))
    .join("; ");

  const xValues = pathWaypoints.map((wp) => wp.x).join("; ");
  const yValues = pathWaypoints.map((wp) => wp.y).join("; ");

  // Create Snake Body segments (head + 5 tail segments with opacity trail fade)
  const bodyLength = 6;
  let snakeSvg = "";

  for (let i = 0; i < bodyLength; i++) {
    const opacity = (1 - i * 0.13).toFixed(2);
    const isHead = i === 0;
    const delayOffset = (i * 0.08).toFixed(2); // trailing delay in seconds

    snakeSvg += `
      <rect
        width="${cellSize}"
        height="${cellSize}"
        rx="3"
        fill="#39d353"
        opacity="${opacity}"
        ${isHead ? 'filter="url(#snakeHeadGlow)"' : ""}>
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

  // Month labels
  let monthLabels = "";
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
          y="56"
          fill="#8b949e"
          font-family="monospace"
          font-size="11">
          ${monthName}
        </text>
      `;
    }
  });

  return `
<svg
  width="920"
  height="210"
  viewBox="0 0 920 210"
  xmlns="http://www.w3.org/2000/svg">

  <defs>
    <!-- Snake Head Soft Glow Filter -->
    <filter id="snakeHeadGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Header Gradient -->
    <linearGradient id="snakeCardGlow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#39d353" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.02"/>
    </linearGradient>
  </defs>

  <!-- CARD CONTAINER -->
  <rect
    width="920"
    height="210"
    rx="16"
    fill="#0d1117"
    stroke="#30363d"
    stroke-width="1.5"/>

  <!-- HEADER GLOW ACCENT -->
  <rect
    x="12"
    y="12"
    width="896"
    height="32"
    rx="8"
    fill="url(#snakeCardGlow)"/>

  <!-- CAPTION TITLE -->
  <text
    x="24"
    y="33"
    fill="#8b949e"
    font-family="monospace"
    font-size="12"
    font-weight="600">
    // CONTRIBUTION SNAKE • AUTO-REPLAYS
  </text>

  <!-- LIVE SNAKE EATING BADGE -->
  <g transform="translate(780, 24)">
    <circle cx="6" cy="9" r="4.5" fill="#39d353" filter="url(#snakeHeadGlow)">
      <animate attributeName="opacity" values="1; 0.3; 1" dur="1.5s" repeatCount="indefinite"/>
    </circle>
    <text
      x="18"
      y="13"
      fill="#39d353"
      font-family="monospace"
      font-size="11"
      font-weight="700">
      HUNGRY
    </text>
  </g>

  <!-- MONTH LABELS -->
  ${monthLabels}

  <!-- CONTRIBUTION GRID (WITH EATEN CELL DRAIN ANIMATIONS) -->
  ${gridSvg}

  <!-- ANIMATED SNAKE (HEAD + TAIL TRAIL) -->
  ${snakeSvg}
</svg>
`;
}

async function main() {
  console.log("Generating Contribution Snake SVG...");

  let calendar;
  if (githubToken) {
    console.log("Using GITHUB_TOKEN to fetch GraphQL calendar...");
    calendar = await fetchContributions();
  } else {
    console.log("No GITHUB_TOKEN provided. Generating mock calendar for snake...");
    calendar = generateMockCalendar();
  }

  const snakeSvg = buildSnakeSVG(calendar);

  const outputDirectory = path.join(__dirname, "..", "assets");
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  const outputPath = path.join(outputDirectory, "snake.svg");
  fs.writeFileSync(outputPath, snakeSvg.trim(), "utf8");

  console.log(`Snake SVG generated successfully: ${outputPath}`);
}

main().catch((err) => {
  console.error("Snake generation failed:");
  console.error(err);
  process.exit(1);
});
