/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

var html = require('@lexical/html');
var selection = require('@lexical/selection');
var utils = require('@lexical/utils');
var lexical = require('lexical');

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

const CAN_USE_DOM = typeof window !== 'undefined' && typeof window.document !== 'undefined' && typeof window.document.createElement !== 'undefined';

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
const getDOMSelection = targetWindow => CAN_USE_DOM ? (targetWindow || window).getSelection() : null;

/**
 * Returns the *currently selected* Lexical content as an HTML string, relying on the
 * logic defined in the exportDOM methods on the LexicalNode classes. Note that
 * this will not return the HTML content of the entire editor (unless all the content is included
 * in the current selection).
 *
 * @param editor - LexicalEditor instance to get HTML content from
 * @returns a string of HTML content
 */
function $getHtmlContent(editor) {
  const selection = lexical.$getSelection();
  if (selection == null) {
    {
      throw Error(`Expected valid LexicalSelection`);
    }
  }

  // If we haven't selected anything
  if (lexical.$isRangeSelection(selection) && selection.isCollapsed() || selection.getNodes().length === 0) {
    return '';
  }
  return html.$generateHtmlFromNodes(editor, selection);
}

/**
 * Returns the *currently selected* Lexical content as a JSON string, relying on the
 * logic defined in the exportJSON methods on the LexicalNode classes. Note that
 * this will not return the JSON content of the entire editor (unless all the content is included
 * in the current selection).
 *
 * @param editor  - LexicalEditor instance to get the JSON content from
 * @returns
 */
function $getLexicalContent(editor) {
  const selection = lexical.$getSelection();
  if (selection == null) {
    {
      throw Error(`Expected valid LexicalSelection`);
    }
  }

  // If we haven't selected anything
  if (lexical.$isRangeSelection(selection) && selection.isCollapsed() || selection.getNodes().length === 0) {
    return null;
  }
  return JSON.stringify($generateJSONFromSelectedNodes(editor, selection));
}

/**
 * Attempts to insert content of the mime-types text/plain or text/uri-list from
 * the provided DataTransfer object into the editor at the provided selection.
 * text/uri-list is only used if text/plain is not also provided.
 *
 * @param dataTransfer an object conforming to the [DataTransfer interface] (https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface)
 * @param selection the selection to use as the insertion point for the content in the DataTransfer object
 */
function $insertDataTransferForPlainText(dataTransfer, selection) {
  const text = dataTransfer.getData('text/plain') || dataTransfer.getData('text/uri-list');
  if (text != null) {
    selection.insertRawText(text);
  }
}

/**
 * Attempts to insert content of the mime-types application/x-lexical-editor, text/html,
 * text/plain, or text/uri-list (in descending order of priority) from the provided DataTransfer
 * object into the editor at the provided selection.
 *
 * @param dataTransfer an object conforming to the [DataTransfer interface] (https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface)
 * @param selection the selection to use as the insertion point for the content in the DataTransfer object
 * @param editor the LexicalEditor the content is being inserted into.
 */
function $insertDataTransferForRichText(dataTransfer, selection, editor) {
  const lexicalString = dataTransfer.getData('application/x-lexical-editor');
  if (lexicalString) {
    try {
      const payload = JSON.parse(lexicalString);
      if (payload.namespace === editor._config.namespace && Array.isArray(payload.nodes)) {
        const nodes = $generateNodesFromSerializedNodes(payload.nodes);
        return $insertGeneratedNodes(editor, nodes, selection);
      }
    } catch {
      // Fail silently.
    }
  }
  const htmlString = dataTransfer.getData('text/html');
  if (htmlString) {
    try {
      const parser = new DOMParser();
      const dom = parser.parseFromString(htmlString, 'text/html');
      const nodes = html.$generateNodesFromDOM(editor, dom);
      return $insertGeneratedNodes(editor, nodes, selection);
    } catch {
      // Fail silently.
    }
  }

  // Multi-line plain text in rich text mode pasted as separate paragraphs
  // instead of single paragraph with linebreaks.
  // Webkit-specific: Supports read 'text/uri-list' in clipboard.
  const text = dataTransfer.getData('text/plain') || dataTransfer.getData('text/uri-list');
  if (text != null) {
    if (lexical.$isRangeSelection(selection)) {
      const parts = text.split(/(\r?\n|\t)/);
      const partsLength = parts.length;
      for (let i = 0; i < partsLength; i++) {
        const part = parts[i];
        if (part === '\n' || part === '\r\n') {
          selection.insertParagraph();
        } else if (part === '\t') {
          selection.insertNodes([lexical.$createTabNode()]);
        } else {
          selection.insertText(part);
        }
      }
    } else {
      selection.insertRawText(text);
    }
  }
}

/**
 * Inserts Lexical nodes into the editor using different strategies depending on
 * some simple selection-based heuristics. If you're looking for a generic way to
 * to insert nodes into the editor at a specific selection point, you probably want
 * {@link lexical.$insertNodes}
 *
 * @param editor LexicalEditor instance to insert the nodes into.
 * @param nodes The nodes to insert.
 * @param selection The selection to insert the nodes into.
 */
function $insertGeneratedNodes(editor, nodes, selection) {
  const isSelectionInsideOfGrid = lexical.DEPRECATED_$isGridSelection(selection) || utils.$findMatchingParent(selection.anchor.getNode(), n => lexical.DEPRECATED_$isGridCellNode(n)) !== null && utils.$findMatchingParent(selection.focus.getNode(), n => lexical.DEPRECATED_$isGridCellNode(n)) !== null;
  if (isSelectionInsideOfGrid && nodes.length === 1 && lexical.DEPRECATED_$isGridNode(nodes[0])) {
    $mergeGridNodesStrategy(nodes, selection, false, editor);
    return;
  }
  $basicInsertStrategy(nodes, selection);
  return;
}
function $basicInsertStrategy(nodes, selection) {
  // Wrap text and inline nodes in paragraph nodes so we have all blocks at the top-level
  const topLevelBlocks = [];
  let currentBlock = null;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLineBreakNode = lexical.$isLineBreakNode(node);
    if (isLineBreakNode || lexical.$isDecoratorNode(node) && node.isInline() || lexical.$isElementNode(node) && node.isInline() || lexical.$isTextNode(node) || node.isParentRequired()) {
      if (currentBlock === null) {
        currentBlock = node.createParentElementNode();
        topLevelBlocks.push(currentBlock);
        // In the case of LineBreakNode, we just need to
        // add an empty ParagraphNode to the topLevelBlocks.
        if (isLineBreakNode) {
          continue;
        }
      }
      if (currentBlock !== null) {
        currentBlock.append(node);
      }
    } else {
      topLevelBlocks.push(node);
      currentBlock = null;
    }
  }
  if (lexical.$isRangeSelection(selection)) {
    selection.insertNodes(topLevelBlocks);
  } else if (lexical.DEPRECATED_$isGridSelection(selection)) {
    // If there's an active grid selection and a non grid is pasted, add to the anchor.
    const anchorCell = selection.anchor.getNode();
    if (!lexical.DEPRECATED_$isGridCellNode(anchorCell)) {
      {
        throw Error(`Expected Grid Cell in Grid Selection`);
      }
    }
    anchorCell.append(...topLevelBlocks);
  }
}
function $mergeGridNodesStrategy(nodes, selection, isFromLexical, editor) {
  if (nodes.length !== 1 || !lexical.DEPRECATED_$isGridNode(nodes[0])) {
    {
      throw Error(`$mergeGridNodesStrategy: Expected Grid insertion.`);
    }
  }
  const newGrid = nodes[0];
  const newGridRows = newGrid.getChildren();
  const newColumnCount = newGrid.getFirstChildOrThrow().getChildrenSize();
  const newRowCount = newGrid.getChildrenSize();
  const gridCellNode = utils.$findMatchingParent(selection.anchor.getNode(), n => lexical.DEPRECATED_$isGridCellNode(n));
  const gridRowNode = gridCellNode && utils.$findMatchingParent(gridCellNode, n => lexical.DEPRECATED_$isGridRowNode(n));
  const gridNode = gridRowNode && utils.$findMatchingParent(gridRowNode, n => lexical.DEPRECATED_$isGridNode(n));
  if (!lexical.DEPRECATED_$isGridCellNode(gridCellNode) || !lexical.DEPRECATED_$isGridRowNode(gridRowNode) || !lexical.DEPRECATED_$isGridNode(gridNode)) {
    {
      throw Error(`$mergeGridNodesStrategy: Expected selection to be inside of a Grid.`);
    }
  }
  const startY = gridRowNode.getIndexWithinParent();
  const stopY = Math.min(gridNode.getChildrenSize() - 1, startY + newRowCount - 1);
  const startX = gridCellNode.getIndexWithinParent();
  const stopX = Math.min(gridRowNode.getChildrenSize() - 1, startX + newColumnCount - 1);
  const fromX = Math.min(startX, stopX);
  const fromY = Math.min(startY, stopY);
  const toX = Math.max(startX, stopX);
  const toY = Math.max(startY, stopY);
  const gridRowNodes = gridNode.getChildren();
  let newRowIdx = 0;
  let newAnchorCellKey;
  let newFocusCellKey;
  for (let r = fromY; r <= toY; r++) {
    const currentGridRowNode = gridRowNodes[r];
    if (!lexical.DEPRECATED_$isGridRowNode(currentGridRowNode)) {
      {
        throw Error(`getNodes: expected to find GridRowNode`);
      }
    }
    const newGridRowNode = newGridRows[newRowIdx];
    if (!lexical.DEPRECATED_$isGridRowNode(newGridRowNode)) {
      {
        throw Error(`getNodes: expected to find GridRowNode`);
      }
    }
    const gridCellNodes = currentGridRowNode.getChildren();
    const newGridCellNodes = newGridRowNode.getChildren();
    let newColumnIdx = 0;
    for (let c = fromX; c <= toX; c++) {
      const currentGridCellNode = gridCellNodes[c];
      if (!lexical.DEPRECATED_$isGridCellNode(currentGridCellNode)) {
        {
          throw Error(`getNodes: expected to find GridCellNode`);
        }
      }
      const newGridCellNode = newGridCellNodes[newColumnIdx];
      if (!lexical.DEPRECATED_$isGridCellNode(newGridCellNode)) {
        {
          throw Error(`getNodes: expected to find GridCellNode`);
        }
      }
      if (r === fromY && c === fromX) {
        newAnchorCellKey = currentGridCellNode.getKey();
      } else if (r === toY && c === toX) {
        newFocusCellKey = currentGridCellNode.getKey();
      }
      const originalChildren = currentGridCellNode.getChildren();
      newGridCellNode.getChildren().forEach(child => {
        if (lexical.$isTextNode(child)) {
          const paragraphNode = lexical.$createParagraphNode();
          paragraphNode.append(child);
          currentGridCellNode.append(child);
        } else {
          currentGridCellNode.append(child);
        }
      });
      originalChildren.forEach(n => n.remove());
      newColumnIdx++;
    }
    newRowIdx++;
  }
  if (newAnchorCellKey && newFocusCellKey) {
    const newGridSelection = lexical.DEPRECATED_$createGridSelection();
    newGridSelection.set(gridNode.getKey(), newAnchorCellKey, newFocusCellKey);
    lexical.$setSelection(newGridSelection);
    editor.dispatchCommand(lexical.SELECTION_CHANGE_COMMAND, undefined);
  }
}
function exportNodeToJSON(node) {
  const serializedNode = node.exportJSON();
  const nodeClass = node.constructor;

  // @ts-expect-error TODO Replace Class utility type with InstanceType
  if (serializedNode.type !== nodeClass.getType()) {
    {
      throw Error(`LexicalNode: Node ${nodeClass.name} does not implement .exportJSON().`);
    }
  }

  // @ts-expect-error TODO Replace Class utility type with InstanceType
  const serializedChildren = serializedNode.children;
  if (lexical.$isElementNode(node)) {
    if (!Array.isArray(serializedChildren)) {
      {
        throw Error(`LexicalNode: Node ${nodeClass.name} is an element but .exportJSON() does not have a children array.`);
      }
    }
  }
  return serializedNode;
}
function $appendNodesToJSON(editor, selection$1, currentNode, targetArray = []) {
  let shouldInclude = selection$1 != null ? currentNode.isSelected(selection$1) : true;
  const shouldExclude = lexical.$isElementNode(currentNode) && currentNode.excludeFromCopy('html');
  let target = currentNode;
  if (selection$1 !== null) {
    let clone = selection.$cloneWithProperties(currentNode);
    clone = lexical.$isTextNode(clone) && selection$1 != null ? selection.$sliceSelectedTextNodeContent(selection$1, clone) : clone;
    target = clone;
  }
  const children = lexical.$isElementNode(target) ? target.getChildren() : [];
  const serializedNode = exportNodeToJSON(target);

  // TODO: TextNode calls getTextContent() (NOT node.__text) within it's exportJSON method
  // which uses getLatest() to get the text from the original node with the same key.
  // This is a deeper issue with the word "clone" here, it's still a reference to the
  // same node as far as the LexicalEditor is concerned since it shares a key.
  // We need a way to create a clone of a Node in memory with it's own key, but
  // until then this hack will work for the selected text extract use case.
  if (lexical.$isTextNode(target)) {
    const text = target.__text;
    // If an uncollapsed selection ends or starts at the end of a line of specialized,
    // TextNodes, such as code tokens, we will get a 'blank' TextNode here, i.e., one
    // with text of length 0. We don't want this, it makes a confusing mess. Reset!
    if (text.length > 0) {
      serializedNode.text = text;
    } else {
      shouldInclude = false;
    }
  }
  for (let i = 0; i < children.length; i++) {
    const childNode = children[i];
    const shouldIncludeChild = $appendNodesToJSON(editor, selection$1, childNode, serializedNode.children);
    if (!shouldInclude && lexical.$isElementNode(currentNode) && shouldIncludeChild && currentNode.extractWithChild(childNode, selection$1, 'clone')) {
      shouldInclude = true;
    }
  }
  if (shouldInclude && !shouldExclude) {
    targetArray.push(serializedNode);
  } else if (Array.isArray(serializedNode.children)) {
    for (let i = 0; i < serializedNode.children.length; i++) {
      const serializedChildNode = serializedNode.children[i];
      targetArray.push(serializedChildNode);
    }
  }
  return shouldInclude;
}

// TODO why $ function with Editor instance?
/**
 * Gets the Lexical JSON of the nodes inside the provided Selection.
 *
 * @param editor LexicalEditor to get the JSON content from.
 * @param selection Selection to get the JSON content from.
 * @returns an object with the editor namespace and a list of serializable nodes as JavaScript objects.
 */
function $generateJSONFromSelectedNodes(editor, selection) {
  const nodes = [];
  const root = lexical.$getRoot();
  const topLevelChildren = root.getChildren();
  for (let i = 0; i < topLevelChildren.length; i++) {
    const topLevelNode = topLevelChildren[i];
    $appendNodesToJSON(editor, selection, topLevelNode, nodes);
  }
  return {
    namespace: editor._config.namespace,
    nodes
  };
}

/**
 * This method takes an array of objects conforming to the BaseSeralizedNode interface and returns
 * an Array containing instances of the corresponding LexicalNode classes registered on the editor.
 * Normally, you'd get an Array of BaseSerialized nodes from {@link $generateJSONFromSelectedNodes}
 *
 * @param serializedNodes an Array of objects conforming to the BaseSerializedNode interface.
 * @returns an Array of Lexical Node objects.
 */
function $generateNodesFromSerializedNodes(serializedNodes) {
  const nodes = [];
  for (let i = 0; i < serializedNodes.length; i++) {
    const serializedNode = serializedNodes[i];
    const node = lexical.$parseSerializedNode(serializedNode);
    if (lexical.$isTextNode(node)) {
      selection.$addNodeStyle(node);
    }
    nodes.push(node);
  }
  return nodes;
}
const EVENT_LATENCY = 50;
let clipboardEventTimeout = null;

// TODO custom selection
// TODO potentially have a node customizable version for plain text
/**
 * Copies the content of the current selection to the clipboard in
 * text/plain, text/html, and application/x-lexical-editor (Lexical JSON)
 * formats.
 *
 * @param editor the LexicalEditor instance to copy content from
 * @param event the native browser ClipboardEvent to add the content to.
 * @returns
 */
async function copyToClipboard(editor, event) {
  if (clipboardEventTimeout !== null) {
    // Prevent weird race conditions that can happen when this function is run multiple times
    // synchronously. In the future, we can do better, we can cancel/override the previously running job.
    return false;
  }
  if (event !== null) {
    return new Promise((resolve, reject) => {
      editor.update(() => {
        resolve($copyToClipboardEvent(editor, event));
      });
    });
  }
  const rootElement = editor.getRootElement();
  const windowDocument = editor._window == null ? window.document : editor._window.document;
  const domSelection = getDOMSelection(editor._window);
  if (rootElement === null || domSelection === null) {
    return false;
  }
  const element = windowDocument.createElement('span');
  element.style.cssText = 'position: fixed; top: -1000px;';
  element.append(windowDocument.createTextNode('#'));
  rootElement.append(element);
  const range = new Range();
  range.setStart(element, 0);
  range.setEnd(element, 1);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  return new Promise((resolve, reject) => {
    const removeListener = editor.registerCommand(lexical.COPY_COMMAND, secondEvent => {
      if (utils.objectKlassEquals(secondEvent, ClipboardEvent)) {
        removeListener();
        if (clipboardEventTimeout !== null) {
          window.clearTimeout(clipboardEventTimeout);
          clipboardEventTimeout = null;
        }
        resolve($copyToClipboardEvent(editor, secondEvent));
      }
      // Block the entire copy flow while we wait for the next ClipboardEvent
      return true;
    }, lexical.COMMAND_PRIORITY_CRITICAL);
    // If the above hack execCommand hack works, this timeout code should never fire. Otherwise,
    // the listener will be quickly freed so that the user can reuse it again
    clipboardEventTimeout = window.setTimeout(() => {
      removeListener();
      clipboardEventTimeout = null;
      resolve(false);
    }, EVENT_LATENCY);
    windowDocument.execCommand('copy');
    element.remove();
  });
}

// TODO shouldn't pass editor (pass namespace directly)
function $copyToClipboardEvent(editor, event) {
  const domSelection = getDOMSelection(editor._window);
  if (!domSelection) {
    return false;
  }
  const anchorDOM = domSelection.anchorNode;
  const focusDOM = domSelection.focusNode;
  if (anchorDOM !== null && focusDOM !== null && !lexical.isSelectionWithinEditor(editor, anchorDOM, focusDOM)) {
    return false;
  }
  event.preventDefault();
  const clipboardData = event.clipboardData;
  const selection = lexical.$getSelection();
  if (clipboardData === null || selection === null) {
    return false;
  }
  const htmlString = $getHtmlContent(editor);
  const lexicalString = $getLexicalContent(editor);
  let plainString = '';
  if (selection !== null) {
    plainString = selection.getTextContent();
  }
  if (htmlString !== null) {
    clipboardData.setData('text/html', htmlString);
  }
  if (lexicalString !== null) {
    clipboardData.setData('application/x-lexical-editor', lexicalString);
  }
  clipboardData.setData('text/plain', plainString);
  return true;
}

exports.$generateJSONFromSelectedNodes = $generateJSONFromSelectedNodes;
exports.$generateNodesFromSerializedNodes = $generateNodesFromSerializedNodes;
exports.$getHtmlContent = $getHtmlContent;
exports.$getLexicalContent = $getLexicalContent;
exports.$insertDataTransferForPlainText = $insertDataTransferForPlainText;
exports.$insertDataTransferForRichText = $insertDataTransferForRichText;
exports.$insertGeneratedNodes = $insertGeneratedNodes;
exports.copyToClipboard = copyToClipboard;
