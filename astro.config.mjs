import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: '面试防穿透知识库',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/',
        },
      ],
      sidebar: [
        {
          label: 'Roadmap',
          items: [
            { label: '总览', slug: 'roadmap/overview' },
            { label: '学习排期', slug: 'roadmap/schedules' },
            { label: '复习优先级', slug: 'roadmap/priorities' },
            { label: 'Demo 与产出物', slug: 'roadmap/demos-and-outputs' },
          ],
        },
        {
          label: 'Knowledge',
          items: [
            { label: 'C++ / Linux / 工程能力', slug: 'knowledge/cpp-linux' },
            { label: '交易系统', slug: 'knowledge/trading-system' },
            { label: '模型部署基础', slug: 'knowledge/model-deployment' },
            { label: 'MLIR 工具链', slug: 'knowledge/mlir' },
            { label: '图优化与性能分析', slug: 'knowledge/graph-optimization' },
            { label: '量化与精度分析', slug: 'knowledge/quantization' },
            { label: '端侧 NPU 部署', slug: 'knowledge/edge-npu' },
            { label: '大模型推理', slug: 'knowledge/llm-inference' },
            { label: 'Agent / RAG / Memory', slug: 'knowledge/agent-rag-memory' },
            { label: 'OpenGL 2D 渲染', slug: 'knowledge/opengl-2d' },
          ],
        },
        {
          label: 'Interview',
          items: [
            { label: '简历防穿透表', slug: 'interview/resume-defense' },
            { label: '项目复盘', slug: 'interview/project-retrospectives' },
            { label: '面试题总清单', slug: 'interview/question-bank' },
            { label: '边界表达原则', slug: 'interview/boundary-expression' },
          ],
        },
        {
          label: 'Templates',
          items: [
            { label: '每日学习模板', slug: 'templates/daily-learning' },
            { label: '每周复盘模板', slug: 'templates/weekly-review' },
            { label: 'AI 填充提示模板', slug: 'templates/ai-fill-prompt' },
          ],
        },
      ],
    }),
  ],
});
