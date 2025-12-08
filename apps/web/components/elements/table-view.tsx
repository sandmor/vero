'use client';

import { type ReactNode, type TableHTMLAttributes, useMemo } from 'react';
import Papa from 'papaparse';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BlockTopBar } from './block-top-bar';

export type TableViewProps = TableHTMLAttributes<HTMLTableElement> & {
  content?: string;
  className?: string;
  children?: ReactNode;
};

export const TableView = ({
  content,
  className,
  children,
  ...props
}: TableViewProps) => {
  const parsedData = useMemo(() => {
    if (!content) return null;
    return Papa.parse<string[]>(content.trim(), {
      delimiter: '\t',
      skipEmptyLines: true,
    });
  }, [content]);

  // If we have content, we render based on parsed data (TSV mode)
  if (content && parsedData?.data && parsedData.data.length > 0) {
    const headers = parsedData.data[0];
    const rows = parsedData.data.slice(1);

    return (
      <div className="my-4 w-full overflow-hidden rounded-md border bg-background">
        <BlockTopBar title="TSV" content={content} />
        <Table className={className} {...props}>
          <TableHeader>
            <TableRow>
              {headers.map((header, index) => (
                <TableHead key={index}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Otherwise, we render children (Markdown mode)
  // Note: standard markdown children (thead, tbody, tr, td) should be overridden
  // in the markdown renderer to map to Shadcn components for consistent styling.
  if (children) {
    return (
      <div className="my-4 w-full overflow-hidden rounded-md border bg-background">
        <BlockTopBar title="Table" />
        <Table className={className} {...props}>
          {children}
        </Table>
      </div>
    );
  }

  return null;
};
