---
title: Model Deployment Notes
description: ONNX graph structure and deployment validation.
---

# Model Deployment Notes

Model deployment requires checking format conversion, operator semantics, tensor shapes, data layout, preprocessing, postprocessing, and runtime behavior.

## ONNX graph structure

- Graph: the full computation graph.
- Node: an operator node such as Conv, Relu, or Reshape.
- Initializer: weights and constants.
- Attribute: operator parameters such as stride, padding, and axis.
- Opset: the operator semantic version.
- ValueInfo: tensor shape and type metadata.

## Validation flow

1. Single operator tests.
2. Subgraph tests.
3. Full model tests.
4. Layerwise dump for locating the first large numerical difference.

## References

- ONNX: https://onnx.ai/
- ONNX Operators: https://onnx.ai/onnx/operators/
- ONNX Runtime: https://onnxruntime.ai/
- Netron: https://netron.app/
