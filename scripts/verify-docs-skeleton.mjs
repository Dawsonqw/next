import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'package.json',
  'astro.config.mjs',
  'tsconfig.json',
  'src/content.config.ts',
  'src/content/docs/index.mdx',
  'src/content/docs/roadmap/overview.md',
  'src/content/docs/roadmap/schedules.md',
  'src/content/docs/roadmap/priorities.md',
  'src/content/docs/roadmap/demos-and-outputs.md',
  'src/content/docs/knowledge/cpp-linux.md',
  'src/content/docs/knowledge/trading-system.md',
  'src/content/docs/knowledge/model-deployment.md',
  'src/content/docs/knowledge/mlir.md',
  'src/content/docs/knowledge/graph-optimization.md',
  'src/content/docs/knowledge/quantization.md',
  'src/content/docs/knowledge/edge-npu.md',
  'src/content/docs/knowledge/llm-inference.md',
  'src/content/docs/knowledge/agent-rag-memory.md',
  'src/content/docs/knowledge/opengl-2d.md',
  'src/content/docs/interview/resume-defense.md',
  'src/content/docs/interview/project-retrospectives.md',
  'src/content/docs/interview/question-bank.md',
  'src/content/docs/interview/boundary-expression.md',
  'src/content/docs/templates/daily-learning.md',
  'src/content/docs/templates/weekly-review.md',
  'src/content/docs/templates/ai-fill-prompt.md',
  'reference/简历面试学习计划.md',
];

const configMarkers = [
  '面试防穿透知识库',
  'Roadmap',
  'Knowledge',
  'Interview',
  'Templates',
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));

if (missingFiles.length > 0) {
  console.error('Missing required skeleton files:');
  for (const file of missingFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

const config = readFileSync('astro.config.mjs', 'utf8');
const missingMarkers = configMarkers.filter((marker) => !config.includes(marker));

if (missingMarkers.length > 0) {
  console.error('Missing required Starlight config markers:');
  for (const marker of missingMarkers) {
    console.error(`- ${marker}`);
  }
  process.exit(1);
}

console.log(`Verified ${requiredFiles.length} skeleton files and ${configMarkers.length} config markers.`);
