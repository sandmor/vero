import Image from 'next/image';
import { useState } from 'react';
import type { Attachment } from '@/lib/types';
import { Loader } from './elements/loader';
import {
  X,
  File,
  FileImage,
  FileText,
  FileSpreadsheet,
  FileVideo,
  FileAudio,
} from 'lucide-react';
import { Button } from './ui/button';
import { ImageViewer } from './image-viewer';

const getFileIcon = (contentType: string) => {
  if (contentType?.startsWith('image/')) return FileImage;
  if (contentType?.startsWith('video/')) return FileVideo;
  if (contentType?.startsWith('audio/')) return FileAudio;
  if (contentType === 'application/pdf' || contentType?.includes('document'))
    return FileText;
  if (contentType?.includes('spreadsheet') || contentType?.includes('excel'))
    return FileSpreadsheet;
  return File;
};

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
}) => {
  const { name, url, contentType } = attachment;
  const isImage = contentType?.startsWith('image');
  const FileIcon = getFileIcon(contentType || '');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleImageClick = () => {
    if (!isUploading && isImage) {
      setIsModalOpen(true);
    }
  };

  return (
    <>
      <div
        className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-all hover:shadow-md"
        data-testid="input-attachment-preview"
      >
        <div
          className={`aspect-square size-20 overflow-hidden ${
            isImage && !isUploading ? 'cursor-pointer' : ''
          }`}
          onClick={handleImageClick}
        >
          {isImage ? (
            <Image
              alt={name ?? 'An image attachment'}
              className="size-full object-cover"
              height={80}
              src={url}
              width={80}
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted/50">
              <FileIcon size={24} className="text-muted-foreground" />
            </div>
          )}
        </div>

        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader size={20} />
          </div>
        )}

        {onRemove && !isUploading && (
          <Button
            className="absolute top-1 right-1 size-5 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={onRemove}
            size="sm"
            variant="destructive"
          >
            <X size={10} />
          </Button>
        )}

        <div className="truncate bg-muted/80 px-2 py-1 text-xs text-muted-foreground">
          {name}
        </div>
      </div>

      <ImageViewer
        src={url}
        alt={name ?? 'Full-size image'}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
