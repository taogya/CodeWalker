import * as path from 'path';

export interface FolderNode<T extends { filePath: string }> {
  kind: 'folder';
  id: string;
  label: string;
  folderPath: string;
  children: Array<HierarchyNode<T>>;
}

export type HierarchyNode<T extends { filePath: string }> = FolderNode<T> | T;

export function buildFilePathHierarchy<T extends { filePath: string }>(
  items: readonly T[],
  namespace: string,
  getLeafSortKey: (item: T) => string = item => path.posix.basename(item.filePath),
): Array<HierarchyNode<T>> {
  const root: FolderNode<T> = {
    kind: 'folder',
    id: `${namespace}::folder::__root__`,
    label: '',
    folderPath: '',
    children: [],
  };
  const folders = new Map<string, FolderNode<T>>([['', root]]);

  for (const item of items) {
    const dirName = path.posix.dirname(item.filePath);
    if (dirName === '.') {
      root.children.push(item);
      continue;
    }

    const segments = dirName.split('/').filter(Boolean);
    let currentPath = '';
    let parent = root;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let folder = folders.get(currentPath);
      if (!folder) {
        folder = {
          kind: 'folder',
          id: `${namespace}::folder::${currentPath}`,
          label: segment,
          folderPath: currentPath,
          children: [],
        };
        folders.set(currentPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }

    parent.children.push(item);
  }

  sortHierarchy(root.children, getLeafSortKey);
  return root.children;
}

function sortHierarchy<T extends { filePath: string }>(
  children: Array<HierarchyNode<T>>,
  getLeafSortKey: (item: T) => string,
): void {
  children.sort((left, right) => compareHierarchyNodes(left, right, getLeafSortKey));
  for (const child of children) {
    if (isFolderNode(child)) {
      sortHierarchy(child.children, getLeafSortKey);
    }
  }
}

function compareHierarchyNodes<T extends { filePath: string }>(
  left: HierarchyNode<T>,
  right: HierarchyNode<T>,
  getLeafSortKey: (item: T) => string,
): number {
  const leftIsFolder = isFolderNode(left);
  const rightIsFolder = isFolderNode(right);

  if (leftIsFolder !== rightIsFolder) {
    return leftIsFolder ? -1 : 1;
  }

  if (leftIsFolder && rightIsFolder) {
    return left.label.localeCompare(right.label);
  }

  return getLeafSortKey(left as T).localeCompare(getLeafSortKey(right as T));
}

function isFolderNode<T extends { filePath: string }>(node: HierarchyNode<T>): node is FolderNode<T> {
  return typeof node === 'object' && node !== null && 'kind' in node && node.kind === 'folder';
}