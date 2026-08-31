const fs = require("fs");
const path = require("path");

const username = "priyanshu050307";

const dashboard = `
<svg width="1000" height="500" viewBox="0 0 1000 500"
     xmlns="http://www.w3.org/2000/svg">

  <rect width="1000" height="500" rx="18" fill="#0d1117"/>

  <rect x="1" y="1" width="998" height="498"
        rx="18"
        fill="none"
        stroke="#30363d"
        stroke-width="2"/>

  <!-- Header -->
  <text x="50" y="70"
        fill="#f0f6fc"
        font-family="monospace"
        font-size="28"
        font-weight="bold">
    PRIYANSHU VISHWAKARMA
  </text>

  <text x="50" y="105"
        fill="#8b949e"
        font-family="monospace"
        font-size="16">
    CSE STUDENT • DATA SCIENCE • MACHINE LEARNING
  </text>

  <!-- Status -->
  <circle cx="900" cy="65" r="7" fill="#3fb950"/>

  <text x="920" y="71"
        fill="#3fb950"
        font-family="monospace"
        font-size="14">
    BUILDING
  </text>

  <!-- Divider -->
  <line x1="50" y1="140"
        x2="950" y2="140"
        stroke="#30363d"/>

  <!-- Stats -->
  <text x="50" y="190"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
    GITHUB ANALYTICS
  </text>

  <text x="70" y="260"
        fill="#58a6ff"
        font-family="monospace"
        font-size="40"
        font-weight="bold">
    --
  </text>

  <text x="70" y="290"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
    COMMITS
  </text>

  <text x="280" y="260"
        fill="#f85149"
        font-family="monospace"
        font-size="40"
        font-weight="bold">
    --
  </text>

  <text x="280" y="290"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
    STREAK
  </text>

  <text x="490" y="260"
        fill="#d2a8ff"
        font-family="monospace"
        font-size="40"
        font-weight="bold">
    --
  </text>

  <text x="490" y="290"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
    REPOSITORIES
  </text>

  <text x="750" y="260"
        fill="#e3b341"
        font-family="monospace"
        font-size="40"
        font-weight="bold">
    --
  </text>

  <text x="750" y="290"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
    STARS
  </text>

  <!-- Footer -->
  <line x1="50" y1="390"
        x2="950" y2="390"
        stroke="#30363d"/>

  <text x="50" y="440"
        fill="#8b949e"
        font-family="monospace"
        font-size="14">
    SYSTEM STATUS
  </text>

  <text x="50" y="470"
        fill="#3fb950"
        font-family="monospace"
        font-size="16">
    > LEARNING. BUILDING. IMPROVING. REPEATING.
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

console.log(`Dashboard generated for ${username}`);
