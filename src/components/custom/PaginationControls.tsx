
"use client";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemsPerPage: number;
  onItemsPerPageChange?: (value: number) => void;
  className?: string;
}

export function PaginationControls({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  itemsPerPage, 
  onItemsPerPageChange,
  className 
}: PaginationControlsProps) {
  // Return null only if there's only one page AND no per-page changer.
  if (totalPages <= 1 && !onItemsPerPageChange) {
    return null;
  }

  const pageNumbers = () => {
    const delta = 1;
    const range = [];
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
        range.push(i);
    }

    if (currentPage - delta > 2) {
        range.unshift("...");
    }
    if (currentPage + delta < totalPages - 1) {
        range.push("...");
    }

    range.unshift(1);
    if (totalPages > 1) {
        range.push(totalPages);
    }
    
    // Remove duplicates that might occur if totalPages is small
    const uniqueRange = [...new Set(range)];
    // If we have "... 2", it's because current page is 3. Change "..." to 2.
    if(uniqueRange.length > 2 && uniqueRange[1] === '...' && uniqueRange[2] === 3) {
      uniqueRange[1] = 2;
    }
    // If we have "totalPages-2 ... totalPages", change "..." to totalPages-1
    if(uniqueRange.length > 3 && uniqueRange[uniqueRange.length - 3] === totalPages - 2 && uniqueRange[uniqueRange.length - 2] === '...') {
      uniqueRange[uniqueRange.length - 2] = totalPages - 1;
    }

    return uniqueRange;
  };

  return (
    <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-4", className)}>
      <div className="flex items-center justify-center sm:justify-start gap-2 text-sm text-muted-foreground">
        {onItemsPerPageChange && (
          <>
            <span>Rows per page</span>
            <Select
              value={String(itemsPerPage)}
              onValueChange={(value) => onItemsPerPageChange(Number(value))}
            >
              <SelectTrigger className="w-[70px] h-8">
                <SelectValue placeholder={String(itemsPerPage)} />
              </SelectTrigger>
              <SelectContent>
                {[3, 5, 10, 15, 20, 25, 50].filter((v, i, a) => a.indexOf(v) === i).sort((a,b) => a-b).map(size => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      
      {/* Conditionally render the pagination links only if there's more than one page */}
      {totalPages > 1 && (
        <Pagination className="sm:col-start-2 sm:justify-self-center">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => { e.preventDefault(); onPageChange(Math.max(1, currentPage - 1)); }}
                className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            {pageNumbers().map((page, index) =>
              typeof page === "number" ? (
                <PaginationItem key={page}>
                  <PaginationLink href="#" onClick={(e) => { e.preventDefault(); onPageChange(page); }} isActive={currentPage === page}>
                    {page}
                  </PaginationLink>
                </PaginationItem>
              ) : (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => { e.preventDefault(); onPageChange(Math.min(totalPages, currentPage + 1)); }}
                className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
