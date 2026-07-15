"use client";

import React, { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePermissions } from "@/contexts/PermissionContext";

export default function NotificationBell({
  inline = false,
  label,
}: {
  inline?: boolean;
  label?: string;
}) {
  const [count, setCount] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const mounted = useRef(true);
  const countRef = useRef<number>(0);
  const [blink, setBlink] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const { isSuperAdmin } = usePermissions();

  useEffect(() => {
    mounted.current = true;
    const fetchCount = async () => {
      try {
        const endpoint = isSuperAdmin
          ? "/api/admin/tenant-messages/unread-count"
          : "/api/portal/tenant-messages/unread-count";
        const res = await fetch(endpoint, {
          credentials: "same-origin",
        });
        const json = await res.json();
        if (json?.success) {
          const newCount = Number(json.count || 0);
          // Blink when new messages arrive (leave blink state until cleared elsewhere)
          if (newCount > countRef.current) {
            setBlink(true);
          }
          countRef.current = newCount;
          setCount(newCount);
        }
      } catch (e) {
        console.error("Failed to fetch unread count", e);
      }
    };

    fetchCount();
    const iv = setInterval(fetchCount, 30_000);
    return () => {
      mounted.current = false;
      clearInterval(iv);
    };
    // Re-run when admin status changes so we poll the correct endpoint
  }, [isSuperAdmin]);

  const viewAllLink = isSuperAdmin
    ? "/admin/tenant-messages"
    : "/portal/messages";

  const openPanel = async () => {
    setOpen((v) => !v);
    if (!open && isSuperAdmin) {
      setLoading(true);
      try {
        const endpoint = "/api/admin/tenant-messages?page=1&pageSize=20";
        const res = await fetch(endpoint, { credentials: "same-origin" });
        const json = await res.json();
        if (json?.success) {
          // store messages (admin will see full list but we'll show unread in UI)
          setMessages(json.messages || []);
        }
      } catch (e) {
        console.error("Failed to fetch admin tenant messages", e);
      } finally {
        setLoading(false);
        // Admin opened the panel — stop the blink since messages are being viewed
        setBlink(false);
      }
    }
  };

  // close when clicking outside the dropdown
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, [open]);

  const markMessageRead = async (id: string) => {
    if (!isSuperAdmin) return; // tenants cannot mark messages as read
    try {
      const res = await fetch("/api/admin/tenant-messages/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        credentials: "same-origin",
      });
      const json = await res.json();
      if (json?.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, readAt: json.readAt } : m)),
        );
        const newCount = Math.max(0, (countRef.current || 0) - 1);
        countRef.current = newCount;
        setCount(newCount);
        // Admin marked a message as read — clear blink
        setBlink(false);
      }
    } catch (e) {
      console.error("Failed to mark message read", e);
    }
  };

  const wrapperClass = inline
    ? "relative inline-flex items-center"
    : "fixed top-4 right-4 z-50";

  return (
    <div className={wrapperClass}>
      <div className="relative">
        <Button
          variant="ghost"
          onClick={openPanel}
          aria-label={label ? label : "Notifications"}
          className={blink ? "animate-pulse" : ""}
        >
          {label ? <span className="mr-2">{label}</span> : null}
          <MessageSquare className="h-5 w-5" />
          {count > 0 && (
            <Badge className="ml-2" variant="secondary">
              {count}
            </Badge>
          )}
        </Button>

        {open && (
          <div
            ref={panelRef}
            className={`${
              inline ? "absolute right-0 mt-2" : "mt-2"
            } z-50 w-96 max-h-96 shadow-lg bg-background rounded-md border`}
          >
            <Card className="bg-background">
              <CardContent className="p-2">
                <div className="flex items-center justify-between px-2 pb-2">
                  <div className="font-medium">Messages</div>
                  <Link href={viewAllLink} className="text-sm text-primary">
                    View all
                  </Link>
                </div>
                <div className="h-64">
                  {isSuperAdmin ? (
                    loading ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="animate-spin" />
                      </div>
                    ) : // show only unread messages for admins in the popup
                    (messages || []).filter((m) => !m.readAt).length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">
                        No new messages
                      </div>
                    ) : (
                      <ScrollArea className="h-full">
                        <div className="space-y-2 p-2">
                          {(messages || [])
                            .filter((m) => !m.readAt)
                            .map((m) => (
                              <div
                                key={m.id}
                                className="border rounded p-2 bg-secondary/30"
                              >
                                <div className="flex justify-between items-start">
                                  <div className="min-w-0">
                                    <div className="font-medium truncate">
                                      {m.subject || "No subject"}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {m.buildingName
                                        ? `Building: ${m.buildingName}`
                                        : ""}
                                    </div>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {new Date(m.createdAt).toLocaleString()}
                                  </div>
                                </div>
                                <div className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                                  {m.body}
                                </div>
                                <div className="mt-2 flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => markMessageRead(m.id)}
                                  >
                                    Mark read
                                  </Button>
                                </div>
                              </div>
                            ))}
                        </div>
                      </ScrollArea>
                    )
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">
                      Open the messages page to view your messages.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
