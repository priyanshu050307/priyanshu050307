const fs = require("fs");
const path = require("path");

const username = "priyanshu050307";

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "github-profile-dashboard"
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

async function getGitHubData() {
  const user = await fetchJSON(
    `https://api.github.com/users/${username}`
  );

  const repositories = [];
  let page = 1;

  while (true) {
    const repos = await fetchJSON(
      `https://api.github.com/users/${username}/repos?per_page=100&page=${page}&type=owner`
    );

    repositories.push(...repos);

    if (repos.length < 100) {
      break;
    }

    page++;
  }

  const totalStars = repositories.reduce(
    (total, repo) => total + repo.stargazers_count,
    0
  );

  return {
    repositories: user.public_repos,
    followers: user.followers,
    following: user.following,
    stars: totalStars
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

async function generateDashboard() {
  const data = await getGitHubData();

  console.log("GitHub data:");
  console.log(data);

  const dashboard = `
<svg width="1000" height="500"
     viewBox="0 0 1000 500"
     xmlns="http://www.w3.org/2000/svg">

  <rect
    width="1000"
    height="500"
    rx="18"
    fill="#0d1117"
  />

  <rect
    x="1"
    y="1"
    width="998"
    height="498"
    rx="18"
    fill="none"
    stroke="#30363d"
    stroke-width="2"
  />

  <!-- HEADER -->

  <text
    x="50"
    y="70"
    fill="#f0f6fc"
    font-family="monospace"
    font-size="28"
    font-weight="bold">
    PRIYANSHU VISHWAKARMA
  </text>

  <text
    x="50"
    y="105"
    fill="#8b949e"
    font-family="monospace"
    font-size="16">
    CSE STUDENT • DATA SCIENCE • MACHINE LEARNING
  </text>

  <circle
    cx="900"
    cy="65"
    r="7"
    fill="#3fb950"
  />

  <text
    x="920"
    y="71"
    fill="#3fb950"
    font-family="monospace"
    font-size="14">
    BUILDING
  </text>

  <line
    x1="50"
    y1="140"
    x2="950"
    y2="140"
    stroke="#30363d"
  />

  <!-- ANALYTICS -->

  <text
    x="50"
    y="190"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    GITHUB ANALYTICS
  </text>

  <text
    x="70"
    y="260"
    fill="#58a6ff"
    font-family="monospace"
    font-size="40"
    font-weight="bold">
    ${escapeXML(data.repositories)}
  </text>

  <text
    x="70"
    y="290"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    REPOSITORIES
  </text>

  <text
    x="300"
    y="260"
    fill="#f85149"
    font-family="monospace"
    font-size="40"
    font-weight="bold">
    ${escapeXML(data.followers)}
  </text>

  <text
    x="300"
    y="290"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    FOLLOWERS
  </text>

  <text
    x="530"
    y="260"
    fill="#d2a8ff"
    font-family="monospace"
    font-size="40"
    font-weight="bold">
    ${escapeXML(data.stars)}
  </text>

  <text
    x="530"
    y="290"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    STARS
  </text>

  <text
    x="750"
    y="260"
    fill="#e3b341"
    font-family="monospace"
    font-size="40"
    font-weight="bold">
    ${escapeXML(data.following)}
  </text>

  <text
    x="750"
    y="290"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    FOLLOWING
  </text>

  <!-- FOOTER -->

  <line
    x1="50"
    y1="390"
    x2="950"
    y2="390"
    stroke="#30363d"
  />

  <text
    x="50"
    y="440"
    fill="#8b949e"
    font-family="monospace"
    font-size="14">
    SYSTEM STATUS
  </text>

  <text
    x="50"
    y="470"
    fill="#3fb950"
    font-family="monospace"
    font-size="16">
    &gt; LIVE DATA • AUTO-GENERATED • BUILDING
  </text>

</svg>
`;

  const outputDir = path.join(__dirname, "..", "assets");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, "dashboard.svg"),
    dashboard.trim()
  );

  console.log("Dashboard generated successfully.");
}

generateDashboard().catch((error) => {
  console.error(error);
  process.exit(1);
});
