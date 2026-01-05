'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CreatorLogo } from '@/components/creator-logo';
import { formatCost, formatTokens, formatNumber, TokenStackedBar } from './charts';
import type { WidgetConfig } from './dashboard-config';
import { cn } from '@/lib/utils';

// Types
interface TokenBreakdown {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
}

interface CostBreakdown {
    inputCost: number;
    outputCost: number;
    reasoningCost: number;
    cachedInputCost: number;
    extrasCost: number;
    totalCost: number;
}

interface ModelStat {
    id: string;
    name: string;
    creator: string;
    creatorName: string;
    requests: number;
    tokens: TokenBreakdown;
    cost: CostBreakdown;
    byokRequests: number;
    avgTokensPerRequest: number;
}

interface UserStat {
    userId: string;
    email: string | null;
    requests: number;
    tokens: TokenBreakdown;
    cost: CostBreakdown;
    byokRequests: number;
    models: string[];
    lastActive: string;
}

interface RecentActivity {
    id: string;
    user: string;
    userId: string | null;
    modelId: string;
    modelName: string;
    creator: string;
    creatorName: string;
    byok: boolean;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    cost: number;
    timestamp: string;
}

// Sort types
type SortDirection = 'asc' | 'desc';
type ModelSortKey = 'requests' | 'tokens' | 'cost' | 'avgTokensPerRequest';
type UserSortKey = 'requests' | 'tokens' | 'cost' | 'models';

// Sortable header component
interface SortableHeaderProps {
    label: string;
    sortKey: string;
    currentSort: string;
    direction: SortDirection;
    onSort: (key: string) => void;
    className?: string;
}

function SortableHeader({
    label,
    sortKey,
    currentSort,
    direction,
    onSort,
    className,
}: SortableHeaderProps) {
    const isActive = currentSort === sortKey;

    return (
        <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 px-2 font-medium hover:bg-transparent', className)}
            onClick={() => onSort(sortKey)}
        >
            {label}
            {isActive ? (
                direction === 'asc' ? (
                    <ArrowUp className="ml-1 h-3 w-3" />
                ) : (
                    <ArrowDown className="ml-1 h-3 w-3" />
                )
            ) : (
                <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
            )}
        </Button>
    );
}

// Model Stats Table Widget
interface ModelStatsTableProps {
    widget: WidgetConfig;
    data: ModelStat[];
}

export function ModelStatsTable({ widget, data }: ModelStatsTableProps) {
    const [sortKey, setSortKey] = useState<ModelSortKey>('cost');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const limit = widget.settings.limit || 20;

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key as ModelSortKey);
            setSortDirection('desc');
        }
    };

    const toggleRow = (id: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedRows(newExpanded);
    };

    const sortedData = useMemo(() => {
        const sorted = [...data].sort((a, b) => {
            let aValue: number;
            let bValue: number;

            switch (sortKey) {
                case 'requests':
                    aValue = a.requests;
                    bValue = b.requests;
                    break;
                case 'tokens':
                    aValue = a.tokens.totalTokens;
                    bValue = b.tokens.totalTokens;
                    break;
                case 'cost':
                    aValue = a.cost.totalCost;
                    bValue = b.cost.totalCost;
                    break;
                case 'avgTokensPerRequest':
                    aValue = a.avgTokensPerRequest;
                    bValue = b.avgTokensPerRequest;
                    break;
                default:
                    return 0;
            }

            return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        });

        return sorted.slice(0, limit);
    }, [data, sortKey, sortDirection, limit]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: widget.order * 0.05 }}
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{widget.title}</CardTitle>
                    <CardDescription>
                        Detailed breakdown of usage and costs per model
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[500px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="sticky top-0 bg-background w-8" />
                                    <TableHead className="sticky top-0 bg-background">Model</TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Requests"
                                            sortKey="requests"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Tokens"
                                            sortKey="tokens"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Avg/Req"
                                            sortKey="avgTokensPerRequest"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Cost"
                                            sortKey="cost"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">BYOK</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedData.map((model) => (
                                    <Collapsible key={model.id} asChild open={expandedRows.has(model.id)}>
                                        <>
                                            <TableRow className="group">
                                                <TableCell>
                                                    <CollapsibleTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => toggleRow(model.id)}
                                                        >
                                                            {expandedRows.has(model.id) ? (
                                                                <ChevronUp className="h-4 w-4" />
                                                            ) : (
                                                                <ChevronDown className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </CollapsibleTrigger>
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div className="flex items-center gap-2 cursor-help truncate max-w-[200px]">
                                                                    {model.creator && (
                                                                        <CreatorLogo
                                                                            creatorSlug={model.creator}
                                                                            size={14}
                                                                            className="shrink-0"
                                                                        />
                                                                    )}
                                                                    <span className="truncate">{model.name}</span>
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p className="font-medium">{model.name}</p>
                                                                <p className="text-xs text-muted-foreground">{model.id}</p>
                                                                {model.creatorName && (
                                                                    <p className="text-xs text-muted-foreground">
                                                                        by {model.creatorName}
                                                                    </p>
                                                                )}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </TableCell>
                                                <TableCell className="text-right">{formatNumber(model.requests)}</TableCell>
                                                <TableCell className="text-right text-muted-foreground">
                                                    {formatTokens(model.tokens.totalTokens)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {formatTokens(model.avgTokensPerRequest)}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {formatCost(model.cost.totalCost)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {model.byokRequests > 0 ? (
                                                        <Badge variant="secondary" className="text-xs">
                                                            {model.byokRequests}
                                                        </Badge>
                                                    ) : (
                                                        '-'
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                            <CollapsibleContent asChild>
                                                <TableRow className="bg-muted/30">
                                                    <TableCell colSpan={7} className="py-4">
                                                        <div className="grid grid-cols-2 gap-6">
                                                            <div>
                                                                <p className="text-sm font-medium mb-2">Token Breakdown</p>
                                                                <TokenStackedBar
                                                                    inputTokens={model.tokens.inputTokens}
                                                                    outputTokens={model.tokens.outputTokens}
                                                                    reasoningTokens={model.tokens.reasoningTokens}
                                                                    cachedTokens={model.tokens.cachedInputTokens}
                                                                    height={16}
                                                                />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-medium mb-2">Cost Breakdown</p>
                                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                                    <div>
                                                                        <span className="text-muted-foreground">Input:</span>{' '}
                                                                        {formatCost(model.cost.inputCost)}
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted-foreground">Output:</span>{' '}
                                                                        {formatCost(model.cost.outputCost)}
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted-foreground">Reasoning:</span>{' '}
                                                                        {formatCost(model.cost.reasoningCost)}
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted-foreground">Cached:</span>{' '}
                                                                        {formatCost(model.cost.cachedInputCost)}
                                                                    </div>
                                                                    {model.cost.extrasCost > 0 && (
                                                                        <div className="col-span-2">
                                                                            <span className="text-muted-foreground">Extras:</span>{' '}
                                                                            {formatCost(model.cost.extrasCost)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            </CollapsibleContent>
                                        </>
                                    </Collapsible>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// User Stats Table Widget
interface UserStatsTableProps {
    widget: WidgetConfig;
    data: UserStat[];
}

export function UserStatsTable({ widget, data }: UserStatsTableProps) {
    const [sortKey, setSortKey] = useState<UserSortKey>('cost');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const limit = widget.settings.limit || 20;

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key as UserSortKey);
            setSortDirection('desc');
        }
    };

    const sortedData = useMemo(() => {
        const sorted = [...data].sort((a, b) => {
            let aValue: number;
            let bValue: number;

            switch (sortKey) {
                case 'requests':
                    aValue = a.requests;
                    bValue = b.requests;
                    break;
                case 'tokens':
                    aValue = a.tokens.totalTokens;
                    bValue = b.tokens.totalTokens;
                    break;
                case 'cost':
                    aValue = a.cost.totalCost;
                    bValue = b.cost.totalCost;
                    break;
                case 'models':
                    aValue = a.models.length;
                    bValue = b.models.length;
                    break;
                default:
                    return 0;
            }

            return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        });

        return sorted.slice(0, limit);
    }, [data, sortKey, sortDirection, limit]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: widget.order * 0.05 }}
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{widget.title}</CardTitle>
                    <CardDescription>Most active users in the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[500px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="sticky top-0 bg-background">User</TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Requests"
                                            sortKey="requests"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Tokens"
                                            sortKey="tokens"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Cost"
                                            sortKey="cost"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">
                                        <SortableHeader
                                            label="Models"
                                            sortKey="models"
                                            currentSort={sortKey}
                                            direction={sortDirection}
                                            onSort={handleSort}
                                        />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">BYOK</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Last Active</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedData.map((user) => (
                                    <TableRow key={user.userId}>
                                        <TableCell className="font-medium">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="cursor-help truncate max-w-[180px] block">
                                                            {user.email || user.userId}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>{user.userId}</p>
                                                        {user.email && (
                                                            <p className="text-xs text-muted-foreground">{user.email}</p>
                                                        )}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </TableCell>
                                        <TableCell className="text-right">{formatNumber(user.requests)}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {formatTokens(user.tokens.totalTokens)}
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCost(user.cost.totalCost)}
                                        </TableCell>
                                        <TableCell className="text-right">{user.models.length}</TableCell>
                                        <TableCell className="text-right">
                                            {user.byokRequests > 0 ? (
                                                <Badge variant="secondary" className="text-xs">
                                                    {user.byokRequests}
                                                </Badge>
                                            ) : (
                                                '-'
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-xs">
                                            {new Date(user.lastActive).toLocaleDateString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// Recent Activity Table Widget
interface RecentActivityTableProps {
    widget: WidgetConfig;
    data: RecentActivity[];
}

export function RecentActivityTable({ widget, data }: RecentActivityTableProps) {
    const limit = widget.settings.limit || 50;
    const displayData = data.slice(0, limit);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: widget.order * 0.05 }}
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{widget.title}</CardTitle>
                    <CardDescription>Latest token usage records</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[500px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="sticky top-0 bg-background">User</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Model</TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">Input</TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">Output</TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">Total</TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">Cost</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Type</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Time</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {displayData.map((activity) => (
                                    <TableRow key={activity.id}>
                                        <TableCell className="font-medium">
                                            <span className="truncate max-w-[120px] block" title={activity.user}>
                                                {activity.user.split('@')[0]}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div className="flex items-center gap-1.5 truncate max-w-[140px] text-muted-foreground cursor-help">
                                                            {activity.creator && (
                                                                <CreatorLogo
                                                                    creatorSlug={activity.creator}
                                                                    size={12}
                                                                    className="shrink-0"
                                                                />
                                                            )}
                                                            <span className="truncate">{activity.modelName}</span>
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="font-medium">{activity.modelName}</p>
                                                        <p className="text-xs text-muted-foreground">{activity.modelId}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {formatTokens(activity.inputTokens)}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {formatTokens(activity.outputTokens)}
                                        </TableCell>
                                        <TableCell className="text-right">{formatTokens(activity.totalTokens)}</TableCell>
                                        <TableCell className="text-right font-medium">
                                            {formatCost(activity.cost)}
                                        </TableCell>
                                        <TableCell>
                                            {activity.byok ? (
                                                <Badge variant="outline" className="text-xs">
                                                    BYOK
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="text-xs">
                                                    Platform
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-xs">
                                            {new Date(activity.timestamp).toLocaleTimeString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </motion.div>
    );
}
