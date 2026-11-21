// Normalize a selection without silently falling back to every frame on the page.
export function resolveCanvasScreens(selection: readonly SceneNode[]): SceneNode[] {
  const result = new Map<string, SceneNode>();
  const isFrame = (node: BaseNode): node is FrameNode | ComponentNode | ComponentSetNode =>
    node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
  function visit(node: SceneNode) {
    if (isFrame(node)) { result.set(node.id, node); return; }
    const before = result.size;
    // A multi-screen group or section may be a single item in Figma's raw selection.
    if (node.type === 'GROUP' || node.type === 'SECTION') {
      for (const child of node.children) visit(child);
      if (result.size > before) return;
    }
    if (node.type === 'SECTION') return;
    // Selecting content inside a screen should select its nearest screen frame.
    let parent = node.parent;
    while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
      if (isFrame(parent)) { result.set(parent.id, parent); return; }
      parent = parent.parent;
    }
  }
  for (const node of selection) visit(node);
  // Avoid extracting both a selected screen and its nested screen.
  return [...result.values()].filter(node => {
    let parent = node.parent;
    while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
      if (result.has(parent.id)) return false;
      parent = parent.parent;
    }
    return true;
  });
}
