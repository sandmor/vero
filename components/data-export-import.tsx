'use client';

import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download,
    Upload,
    FileJson,
    Check,
    Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/toast';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { cn } from '@/lib/utils';

type ImportMode = 'merge' | 'replace';

type ImportResults = {
    preferences: boolean;
    chats: { imported: number; skipped: number };
    archive: { entries: number; links: number };
    agents: { imported: number; skipped: number };
};

type ExportData = {
    version: number;
    exportedAt: string;
    preferences: unknown;
    chats: unknown[];
    archive: {
        entries: unknown[];
        links: unknown[];
    };
    agents: unknown[];
};

export function DataExportImport() {
    const { refreshCache } = useEncryptedCache();
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importMode, setImportMode] = useState<ImportMode>('merge');
    const [importPreview, setImportPreview] = useState<ExportData | null>(null);
    const [importResults, setImportResults] = useState<ImportResults | null>(
        null
    );
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Export mutation
    const exportMutation = useMutation({
        mutationFn: async () => {
            // First refresh cache to ensure we have latest data
            await refreshCache({ force: true });

            const response = await fetch('/api/user/data');
            if (!response.ok) {
                throw new Error('Failed to export data');
            }
            return response.json();
        },
        onSuccess: (data) => {
            // Create and download JSON file
            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `virid-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({
                type: 'success',
                description: 'Data exported successfully',
            });
        },
        onError: (error) => {
            toast({
                type: 'error',
                description:
                    error instanceof Error ? error.message : 'Failed to export data',
            });
        },
    });

    // Import mutation
    const importMutation = useMutation({
        mutationFn: async ({
            data,
            mode,
        }: {
            data: ExportData;
            mode: ImportMode;
        }) => {
            const response = await fetch('/api/user/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, mode }),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to import data');
            }
            return response.json() as Promise<{ success: boolean; results: ImportResults }>;
        },
        onSuccess: async (data) => {
            setImportResults(data.results);

            // Refresh cache to pick up imported data
            await refreshCache({ force: true });

            toast({
                type: 'success',
                description: 'Data imported successfully',
            });
        },
        onError: (error) => {
            toast({
                type: 'error',
                description:
                    error instanceof Error ? error.message : 'Failed to import data',
            });
        },
    });

    const handleFileSelect = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
                toast({
                    type: 'error',
                    description: 'Please select a valid JSON file',
                });
                return;
            }

            setImportResults(null);

            // Read and preview the file
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target?.result as string) as ExportData;

                    // Validate structure
                    if (data.version !== 1) {
                        toast({
                            type: 'error',
                            description: 'Unsupported export version',
                        });
                        return;
                    }

                    setImportPreview(data);
                    setImportDialogOpen(true);
                } catch {
                    toast({
                        type: 'error',
                        description: 'Invalid JSON file format',
                    });
                }
            };
            reader.readAsText(file);

            // Reset the input so the same file can be selected again
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        },
        []
    );

    const handleImport = useCallback(() => {
        if (!importPreview) return;
        importMutation.mutate({ data: importPreview, mode: importMode });
    }, [importPreview, importMode, importMutation]);

    const handleCloseDialog = useCallback(() => {
        setImportDialogOpen(false);
        setImportPreview(null);
        setImportResults(null);
        setImportMode('merge');
    }, []);

    return (
        <>
            <Card className="border-border/60 bg-card/40 backdrop-blur">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileJson className="h-5 w-5" />
                        Data Export & Import
                    </CardTitle>
                    <CardDescription>
                        Export all your data for backup or transfer to another account.
                        Import previously exported data to restore your settings, chats,
                        archive entries, and agents.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Export Section */}
                    <div className="space-y-3">
                        <div>
                            <h4 className="text-sm font-medium">Export Your Data</h4>
                            <p className="text-xs text-muted-foreground mt-1">
                                Download a JSON file containing all your preferences, chats with
                                messages, archive entries with links, and custom agents.
                            </p>
                        </div>
                        <Button
                            onClick={() => exportMutation.mutate()}
                            disabled={exportMutation.isPending}
                            className="w-full sm:w-auto"
                        >
                            <AnimatePresence mode="wait" initial={false}>
                                {exportMutation.isPending ? (
                                    <motion.span
                                        key="loading"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="flex items-center gap-2"
                                    >
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Preparing export...
                                    </motion.span>
                                ) : (
                                    <motion.span
                                        key="idle"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="flex items-center gap-2"
                                    >
                                        <Download className="h-4 w-4" />
                                        Export All Data
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </Button>
                    </div>

                    <div className="border-t border-border/60" />

                    {/* Import Section */}
                    <div className="space-y-3">
                        <div>
                            <h4 className="text-sm font-medium">Import Data</h4>
                            <p className="text-xs text-muted-foreground mt-1">
                                Restore data from a previously exported JSON file. You can
                                choose to merge with existing data or replace it entirely.
                            </p>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="import-file-input"
                        />
                        <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full sm:w-auto"
                        >
                            <Upload className="h-4 w-4 mr-2" />
                            Select File to Import
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Import Confirmation Dialog */}
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Import Data</DialogTitle>
                        <DialogDescription>
                            {importResults
                                ? 'Import completed. Review the results below.'
                                : 'Review the data that will be imported and choose how to handle conflicts.'}
                        </DialogDescription>
                    </DialogHeader>

                    {!importResults && importPreview && (
                        <>
                            {/* Preview Summary */}
                            <div className="space-y-4 py-4">
                                <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
                                    <p className="text-sm font-medium">File Summary</p>
                                    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                                        <span>Exported:</span>
                                        <span>
                                            {new Date(importPreview.exportedAt).toLocaleDateString()}
                                        </span>
                                        <span>Preferences:</span>
                                        <span>{importPreview.preferences ? 'Yes' : 'No'}</span>
                                        <span>Chats:</span>
                                        <span>{importPreview.chats?.length || 0}</span>
                                        <span>Archive Entries:</span>
                                        <span>{importPreview.archive?.entries?.length || 0}</span>
                                        <span>Archive Links:</span>
                                        <span>{importPreview.archive?.links?.length || 0}</span>
                                        <span>Agents:</span>
                                        <span>{importPreview.agents?.length || 0}</span>
                                    </div>
                                </div>

                                {/* Import Mode Selection */}
                                <div className="space-y-3">
                                    <Label>Import Mode</Label>
                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => setImportMode('merge')}
                                            className={cn(
                                                'flex w-full items-start space-x-3 rounded-lg border p-3 text-left transition-colors',
                                                importMode === 'merge'
                                                    ? 'border-primary bg-primary/5'
                                                    : 'border-border/60 hover:bg-muted/50'
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                                                    importMode === 'merge'
                                                        ? 'border-primary bg-primary'
                                                        : 'border-muted-foreground/50'
                                                )}
                                            >
                                                {importMode === 'merge' && (
                                                    <div className="h-full w-full rounded-full bg-background scale-[0.4]" />
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <span className="font-medium">Merge (Recommended)</span>
                                                <p className="text-xs text-muted-foreground">
                                                    Add new items without modifying existing data. Skip
                                                    items that already exist.
                                                </p>
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setImportMode('replace')}
                                            className={cn(
                                                'flex w-full items-start space-x-3 rounded-lg border p-3 text-left transition-colors',
                                                importMode === 'replace'
                                                    ? 'border-primary bg-primary/5'
                                                    : 'border-border/60 hover:bg-muted/50'
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                                                    importMode === 'replace'
                                                        ? 'border-primary bg-primary'
                                                        : 'border-muted-foreground/50'
                                                )}
                                            >
                                                {importMode === 'replace' && (
                                                    <div className="h-full w-full rounded-full bg-background scale-[0.4]" />
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <span className="font-medium">Replace</span>
                                                <p className="text-xs text-muted-foreground">
                                                    Overwrite existing items with imported data. Use with
                                                    caution.
                                                </p>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" onClick={handleCloseDialog}>
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleImport}
                                    disabled={importMutation.isPending}
                                >
                                    {importMutation.isPending ? (
                                        <span className="flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Importing...
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2">
                                            <Upload className="h-4 w-4" />
                                            Import Data
                                        </span>
                                    )}
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                    {/* Import Results */}
                    {importResults && (
                        <>
                            <div className="space-y-4 py-4">
                                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                                        <Check className="h-5 w-5" />
                                        <span className="font-medium">Import Successful</span>
                                    </div>
                                </div>

                                <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
                                    <p className="text-sm font-medium">Import Results</p>
                                    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                                        <span>Preferences Updated:</span>
                                        <span>{importResults.preferences ? 'Yes' : 'No'}</span>
                                        <span>Chats Imported:</span>
                                        <span>{importResults.chats.imported}</span>
                                        <span>Chats Skipped:</span>
                                        <span>{importResults.chats.skipped}</span>
                                        <span>Archive Entries:</span>
                                        <span>{importResults.archive.entries}</span>
                                        <span>Archive Links:</span>
                                        <span>{importResults.archive.links}</span>
                                        <span>Agents Imported:</span>
                                        <span>{importResults.agents.imported}</span>
                                        <span>Agents Skipped:</span>
                                        <span>{importResults.agents.skipped}</span>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter>
                                <Button onClick={handleCloseDialog}>Done</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
