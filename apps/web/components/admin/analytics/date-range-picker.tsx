'use client';

import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { format, subDays, subHours, subMonths } from 'date-fns';
import { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type PresetRange =
  | '1h'
  | '6h'
  | '24h'
  | '7d'
  | '30d'
  | '90d'
  | '1y'
  | 'custom';

export interface DateRangeValue {
  from: Date;
  to: Date;
  preset: PresetRange;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

const presets: {
  label: string;
  value: PresetRange;
  getRange: () => { from: Date; to: Date };
}[] = [
  {
    label: 'Last hour',
    value: '1h',
    getRange: () => ({ from: subHours(new Date(), 1), to: new Date() }),
  },
  {
    label: 'Last 6 hours',
    value: '6h',
    getRange: () => ({ from: subHours(new Date(), 6), to: new Date() }),
  },
  {
    label: 'Last 24 hours',
    value: '24h',
    getRange: () => ({ from: subHours(new Date(), 24), to: new Date() }),
  },
  {
    label: 'Last 7 days',
    value: '7d',
    getRange: () => ({ from: subDays(new Date(), 7), to: new Date() }),
  },
  {
    label: 'Last 30 days',
    value: '30d',
    getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }),
  },
  {
    label: 'Last 90 days',
    value: '90d',
    getRange: () => ({ from: subDays(new Date(), 90), to: new Date() }),
  },
  {
    label: 'Last year',
    value: '1y',
    getRange: () => ({ from: subMonths(new Date(), 12), to: new Date() }),
  },
];

export function DateRangePicker({
  value,
  onChange,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handlePresetChange = (presetValue: PresetRange) => {
    if (presetValue === 'custom') {
      return;
    }
    const preset = presets.find((p) => p.value === presetValue);
    if (preset) {
      const range = preset.getRange();
      onChange({ ...range, preset: presetValue });
    }
  };

  const handleCalendarChange = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      onChange({ from: range.from, to: range.to, preset: 'custom' });
    } else if (range?.from) {
      onChange({ from: range.from, to: range.from, preset: 'custom' });
    }
  };

  const formatDateRange = () => {
    if (value.preset !== 'custom') {
      const preset = presets.find((p) => p.value === value.preset);
      return preset?.label || 'Select range';
    }

    if (value.from && value.to) {
      if (format(value.from, 'LLL dd, y') === format(value.to, 'LLL dd, y')) {
        return format(value.from, 'LLL dd, y');
      }
      return `${format(value.from, 'LLL dd')} - ${format(value.to, 'LLL dd, y')}`;
    }
    return 'Select range';
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select value={value.preset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Preset" />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'justify-start text-left font-normal min-w-[200px]',
              !value.from && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {formatDateRange()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            autoFocus
            mode="range"
            defaultMonth={value.from}
            selected={{ from: value.from, to: value.to }}
            onSelect={handleCalendarChange}
            numberOfMonths={2}
            disabled={(date) => date > new Date()}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Helper to get a default date range
export function getDefaultDateRange(): DateRangeValue {
  return {
    from: subDays(new Date(), 30),
    to: new Date(),
    preset: '30d',
  };
}

// Helper to convert DateRangeValue to API params
export function dateRangeToParams(range: DateRangeValue): {
  from: string;
  to: string;
} {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}
