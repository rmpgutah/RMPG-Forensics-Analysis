import React, { useState, useEffect } from 'react';
import {
  Apple,
  FolderTree,
  FolderOpen,
  File,
  FileImage,
  FileVideo,
  FileText,
  Database,
  ChevronRight,
  ChevronDown,
  Download,
  Loader2,
  Search,
  CheckSquare,
  Square,
  HardDrive,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'folder' | 'file';
  size: number;
  modified: string;
  category: 'photo' | 'video' | 'document' | 'app_data' | 'system' | 'deleted' | 'other';
  children?: FileNode[];
  isDeleted?: boolean;
}

interface ExtractionProgress {
  percent: number;
  currentFile: string;
  filesExtracted: number;
  totalFiles: number;
  bytesExtracted: number;
  totalBytes: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'photo': return <FileImage size={16} className="text-green-400" />;
    case 'video': return <FileVideo size={16} className="text-purple-400" />;
    case 'document': return <FileText size={16} className="text-blue-400" />;
    case 'app_data': return <Database size={16} className="text-orange-400" />;
    case 'system': return <HardDrive size={16} className="text-gray-400" />;
    case 'deleted': return <Trash2 size={16} className="text-red-400" />;
    default: return <File size={16} className="text-slate-400" />;
  }
};

/* ------------------------------------------------------------------ */
/*  Tree Node Component                                                */
/* ------------------------------------------------------------------ */

const TreeNode: React.FC<{
  node: FileNode;
  depth: number;
  selectedPaths: Set<string>;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onToggleSelect: (path: string) => void;
}> = ({ node, depth, selectedPaths, expandedPaths, onToggleExpand, onToggleSelect }) => {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPaths.has(node.path);
  const isFolder = node.type === 'folder';

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer transition-colors"
        style={{
          paddingLeft: `${depth * 20 + 8}px`,
          backgroundColor: isSelected ? 'var(--bg-hover)' : 'transparent',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isSelected ? 'var(--bg-hover)' : 'transparent')}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(node.path); }}
          className="flex-shrink-0"
        >
          {isSelected
            ? <CheckSquare size={16} className="text-blue-400" />
            : <Square size={16} style={{ color: 'var(--text-muted)' }} />
          }
        </button>

        {isFolder && (
          <button onClick={() => onToggleExpand(node.path)} className="flex-shrink-0">
            {isExpanded
              ? <ChevronDown size={16} style={{ color: 'var(--text-secondary)' }} />
              : <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
            }
          </button>
        )}

        {isFolder
          ? <FolderOpen size={16} className="text-yellow-400 flex-shrink-0" />
          : getCategoryIcon(node.category)
        }

        <span
          className="truncate text-sm"
          style={{ color: node.isDeleted ? '#ef4444' : 'var(--text-primary)' }}
        >
          {node.name}
          {node.isDeleted && ' [DELETED]'}
        </span>

        <span className="ml-auto text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {node.type === 'file' ? formatBytes(node.size) : ''}
        </span>
      </div>

      {isFolder && isExpanded && node.children?.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedPaths={selectedPaths}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosFileExtraction: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalSize: 0,
    photos: 0,
    videos: 0,
    documents: 0,
    appData: 0,
    system: 0,
    deleted: 0,
  });

  const handleBrowseBackup = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, {
        title: 'Select iOS Backup Folder',
      });
      if (result) setBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleBrowseOutput = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, {
        title: 'Select Output Folder',
      });
      if (result) setOutputPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleLoadTree = async () => {
    if (!backupPath) return;
    setLoading(true);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_FILE_BROWSE, {
        backupPath,
      }) as { tree: FileNode[]; stats: typeof stats };
      setFileTree(result.tree);
      setStats(result.stats);
      // Auto-expand root folders
      const rootPaths = new Set(result.tree.map((n: FileNode) => n.path));
      setExpandedPaths(rootPaths);
    } catch (err) {
      console.error('Failed to load file tree:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    const allPaths = new Set<string>();
    const walk = (nodes: FileNode[]) => {
      nodes.forEach((n) => {
        allPaths.add(n.path);
        if (n.children) walk(n.children);
      });
    };
    walk(fileTree);
    setSelectedPaths(allPaths);
  };

  const deselectAll = () => setSelectedPaths(new Set());

  const handleExtractSelected = async () => {
    if (selectedPaths.size === 0 || !outputPath) return;
    setExtracting(true);
    setProgress({ percent: 0, currentFile: '', filesExtracted: 0, totalFiles: selectedPaths.size, bytesExtracted: 0, totalBytes: 0 });
    try {
      await window.api.invoke(IPC_CHANNELS.IOS_FILE_EXTRACT, {
        backupPath,
        outputPath,
        selectedPaths: Array.from(selectedPaths),
        preserveStructure: true,
      });
    } catch (err) {
      console.error('Extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractAll = async () => {
    if (!outputPath || !backupPath) return;
    setExtracting(true);
    setProgress({ percent: 0, currentFile: '', filesExtracted: 0, totalFiles: stats.totalFiles, bytesExtracted: 0, totalBytes: stats.totalSize });
    try {
      await window.api.invoke(IPC_CHANNELS.IOS_FILE_EXTRACT, {
        backupPath,
        outputPath,
        extractAll: true,
        preserveStructure: true,
      });
    } catch (err) {
      console.error('Extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_FILE_EXTRACT_PROGRESS, (_event: unknown, data: ExtractionProgress) => {
      setProgress(data);
      if (data.percent >= 100) setExtracting(false);
    });
    return () => { cleanup?.(); };
  }, []);

  const categories = [
    { key: 'all', label: 'All Files' },
    { key: 'photo', label: 'Photos' },
    { key: 'video', label: 'Videos' },
    { key: 'document', label: 'Documents' },
    { key: 'app_data', label: 'App Data' },
    { key: 'system', label: 'System' },
    { key: 'deleted', label: 'Deleted' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS File Extraction"
        description="Browse and extract files from iOS device backups — photos, videos, documents, app data, system files, and deleted file markers"
        icon={<Apple size={24} />}
      />

      {/* Backup Source + Output */}
      <div className="card" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                iOS Backup Source
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={backupPath}
                  readOnly
                  placeholder="Select iOS backup folder..."
                  className="input-field flex-1"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                />
                <button onClick={handleBrowseBackup} className="btn-secondary" disabled={extracting}>
                  Browse
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                Output Folder
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={outputPath}
                  readOnly
                  placeholder="Select extraction output folder..."
                  className="input-field flex-1"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                />
                <button onClick={handleBrowseOutput} className="btn-secondary" disabled={extracting}>
                  Browse
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleLoadTree} className="btn-primary" disabled={!backupPath || loading || extracting}>
              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <FolderTree size={16} className="mr-2" />}
              {loading ? 'Loading...' : 'Load File Tree'}
            </button>
          </div>
        </div>
      </div>

      {/* Statistics */}
      {fileTree.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Files', value: stats.totalFiles.toLocaleString(), sub: formatBytes(stats.totalSize), color: 'text-blue-400' },
            { label: 'Photos / Videos', value: `${stats.photos} / ${stats.videos}`, sub: 'Media files', color: 'text-green-400' },
            { label: 'Documents / App Data', value: `${stats.documents} / ${stats.appData}`, sub: 'User data', color: 'text-orange-400' },
            { label: 'Deleted Markers', value: stats.deleted.toString(), sub: '.plist tombstones', color: 'text-red-400' },
          ].map((s) => (
            <div key={s.label} className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters + Actions */}
      {fileTree.length > 0 && (
        <div className="card" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="input-field w-full pl-9"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
            </div>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={showDeletedOnly}
                onChange={(e) => setShowDeletedOnly(e.target.checked)}
              />
              Deleted only
            </label>

            <div className="flex gap-2 ml-auto">
              <button onClick={selectAll} className="btn-secondary text-sm">Select All</button>
              <button onClick={deselectAll} className="btn-secondary text-sm">Deselect All</button>
              <button
                onClick={handleExtractSelected}
                className="btn-primary text-sm"
                disabled={selectedPaths.size === 0 || !outputPath || extracting}
              >
                <Download size={14} className="mr-1" />
                Extract Selected ({selectedPaths.size})
              </button>
              <button
                onClick={handleExtractAll}
                className="btn-primary text-sm"
                disabled={!outputPath || extracting}
              >
                Extract All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {extracting && progress && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Extracting files...
            </span>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {progress.filesExtracted} / {progress.totalFiles} files ({Math.round(progress.percent)}%)
            </span>
          </div>
          <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-2 text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            {progress.currentFile}
          </div>
          <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatBytes(progress.bytesExtracted)} / {formatBytes(progress.totalBytes)}
          </div>
        </div>
      )}

      {/* File Tree */}
      {fileTree.length > 0 && (
        <div
          className="card overflow-auto"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            maxHeight: '600px',
          }}
        >
          <div className="p-2">
            {fileTree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedPaths={selectedPaths}
                expandedPaths={expandedPaths}
                onToggleExpand={toggleExpand}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && fileTree.length === 0 && backupPath && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <FolderTree size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Click "Load File Tree" to browse the iOS backup contents</p>
        </div>
      )}
    </div>
  );
};
