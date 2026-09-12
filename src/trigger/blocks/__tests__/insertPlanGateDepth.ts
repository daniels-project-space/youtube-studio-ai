import assert from "node:assert/strict";
import ts from "typescript";

/** Inspect syntax, not a particular const/let spelling or braces in comments. */
export function depthAt(source: string, index: number): number {
  const file = ts.createSourceFile("insert.ts", source, ts.ScriptTarget.Latest, true);
  let loop: ts.ForOfStatement | undefined;
  let gate: ts.Node | undefined;
  function visit(node: ts.Node): void {
    if (ts.isForOfStatement(node) && node.expression.getText(file) === "plan" &&
        ts.isVariableDeclarationList(node.initializer) && node.initializer.declarations.length === 1 &&
        node.initializer.declarations[0].name.getText(file) === "it" &&
        node.statement.getStart(file) < index && index < node.statement.end) loop = node;
    if ((ts.isIfStatement(node) || ts.isVariableStatement(node)) && node.getStart(file) === index) gate = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(loop && ts.isBlock(loop.statement) && gate, "index must identify a gate statement inside the plan loop");
  let depth = 0;
  let parent: ts.Node | undefined = gate.parent;
  while (parent && parent !== loop.statement) { depth++; parent = parent.parent; }
  assert.equal(parent, loop.statement, "gate must belong to the plan loop");
  return depth;
}
