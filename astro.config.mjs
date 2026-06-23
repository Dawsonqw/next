import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://dawsonqw.github.io',
  base: '/next',
  integrations: [
    starlight({
      title: '技术学习笔记',
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
            { label: 'C++ / Linux 深度笔记', slug: 'knowledge/cpp-linux-deep-dive' },
            { label: 'C++ / Linux 原理到应用', slug: 'knowledge/cpp-linux-principles-practice' },
            { label: '高级工程师视角：C++ / Linux 系统工程', slug: 'knowledge/senior-cpp-linux-systems' },
            { label: '交易系统', slug: 'knowledge/trading-system' },
            { label: '交易系统深度笔记', slug: 'knowledge/trading-system-deep-dive' },
            { label: '交易系统原理到应用', slug: 'knowledge/trading-system-principles-practice' },
            { label: '高级工程师视角：交易系统', slug: 'knowledge/senior-trading-systems' },
            { label: '模型部署基础', slug: 'knowledge/model-deployment' },
            { label: '模型部署补充笔记', slug: 'knowledge/model-deployment-notes' },
            { label: '模型部署深度笔记', slug: 'knowledge/model-deployment-deep-dive' },
            { label: '模型部署与量化原理到应用', slug: 'knowledge/model-deployment-quantization-principles' },
            { label: '高级工程师视角：模型部署与量化', slug: 'knowledge/senior-model-deployment-quantization' },
            { label: '高级工程师视角：ONNX 深入专题', slug: 'knowledge/senior-onnx-in-depth' },
            { label: 'MLIR 工具链', slug: 'knowledge/mlir' },
            { label: '图优化与性能分析', slug: 'knowledge/graph-optimization' },
            { label: '量化与精度分析', slug: 'knowledge/quantization' },
            { label: '量化补充笔记', slug: 'knowledge/quantization-notes' },
            { label: '量化深度笔记', slug: 'knowledge/quantization-deep-dive' },
            { label: '端侧 NPU 部署', slug: 'knowledge/edge-npu' },
            { label: '端侧 NPU 深度笔记', slug: 'knowledge/edge-npu-deep-dive' },
            { label: '高级工程师视角：NPU 与端侧 AI 加速器', slug: 'knowledge/senior-npu-edge-accelerators' },
            { label: '大模型推理', slug: 'knowledge/llm-inference' },
            { label: 'Agent / RAG / Memory', slug: 'knowledge/agent-rag-memory' },
            { label: 'Agent Memory 原理到应用', slug: 'knowledge/agent-memory-principles-practice' },
            { label: '高级工程师视角：Agent Memory 架构', slug: 'knowledge/senior-agent-memory-architecture' },
            { label: 'OpenGL 2D 渲染', slug: 'knowledge/opengl-2d' },
            { label: 'OpenGL 2D 补充笔记', slug: 'knowledge/opengl-2d-notes' },
          ],
        },
        {
          label: 'Review',
          items: [
            { label: '资料映射表', slug: 'review/source-map' },
            { label: '官方学习资料索引', slug: 'review/official-learning-sources' },
            { label: '项目记录', slug: 'review/project-notes' },
            { label: '问答清单', slug: 'review/question-set' },
            { label: '扩展问答清单', slug: 'review/question-set-expanded' },
            { label: '边界说明', slug: 'review/boundary-notes' },
            { label: '边界表达示例', slug: 'review/boundary-examples' },
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
