"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PaginationControls } from "@/components/custom/PaginationControls";
import { format, parseISO } from "date-fns";

export default function AdminTenantMessagesPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [marking, setMarking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchMessages = async (p = page, ps = pageSize, query = q) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("pageSize", String(ps));
      if (query) params.set("q", query);

      const res = await fetch(
        `/api/admin/tenant-messages?${params.toString()}`,
        { credentials: "same-origin" },
      );
      const json = await res.json();
      if (json?.success) {
        setMessages(json.messages || []);
        setTotal(Number(json.total || 0));
        setPage(p);
      } else {
        setMessages([]);
        setTotal(0);
      }
    } catch (e) {
      console.error("Failed to fetch admin messages", e);
      setMessages([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages(1, pageSize, q); /* eslint-disable-line */
  }, []);

  const handleSearch = () => fetchMessages(1, pageSize, q);

  const markAsRead = async (id: string) => {
    try {
      setMarking(id);
      const res = await fetch(`/api/admin/tenant-messages/mark-read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        credentials: "same-origin",
      });
      const json = await res.json();
      if (json?.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, readAt: json.readAt || new Date().toISOString() }
              : m,
          ),
        );
      }
    } catch (e) {
      console.error("Mark read failed", e);
    } finally {
      setMarking(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-headline font-bold">Tenant Messages</h1>
      </div>

      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search subject or body..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button onClick={handleSearch}>Search</Button>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              No messages found.
            </div>
          ) : (
            <ScrollArea className="h-[60vh]">
              <div className="space-y-3 p-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className="border rounded p-3 bg-secondary/30"
                  >
                    <div className="flex justify-between items-start">
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {m.subject || "No subject"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.buildingName ? `Building: ${m.buildingName}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          From: {m.tenantName}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(parseISO(m.createdAt), "PP p")}
                      </div>
                    </div>
                    <div
                      className="mt-2 text-sm text-foreground whitespace-pre-wrap"
                      style={
                        !expanded[m.id]
                          ? {
                              display: "-webkit-box",
                              WebkitLineClamp: 5,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }
                          : undefined
                      }
                    >
                      {m.body}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-muted-foreground">
                          {m.readAt ? "Read" : "Unread"}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpanded((p) => ({ ...p, [m.id]: !p[m.id] }))
                          }
                        >
                          {expanded[m.id] ? "Show less" : "Show more"}
                        </Button>
                      </div>
                      {!m.readAt ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={marking === m.id}
                          onClick={() => markAsRead(m.id)}
                        >
                          {marking === m.id ? "Marking..." : "Mark as read"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <div className="mt-4">
            <PaginationControls
              currentPage={page}
              totalPages={Math.max(1, Math.ceil(total / pageSize))}
              onPageChange={(p) => fetchMessages(p, pageSize, q)}
              itemsPerPage={pageSize}
              onItemsPerPageChange={(s) => {
                setPageSize(s);
                fetchMessages(1, s, q);
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
