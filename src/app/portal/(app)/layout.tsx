"use client";

import Link from "next/link";
import {
  UserCircle,
  LogOut,
  Menu,
  Loader2,
  Building,
  LayoutDashboard,
  User,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { usePermissions } from "@/contexts/PermissionContext";
import NotificationBell from "@/components/custom/NotificationBell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendContactEmailAction } from "../actions";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading, currentUser } = usePermissions();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace("/login");
    }
    // Redirection logic for incorrect roles is now handled by the server-side middleware.
    // This useEffect hook is now only responsible for handling unauthenticated users.
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated || !currentUser) {
    return (
      <div className="flex justify-center items-center h-screen w-screen">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PortalHeader />
      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>
      <footer className="bg-muted text-muted-foreground py-4 text-center text-sm">
        © {new Date().getFullYear()} NIB Building Management Solution. All
        rights reserved.
      </footer>
    </div>
  );
}

function PortalHeader() {
  const { logout } = usePermissions();
  const { toast } = useToast();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);
  const [contactSubject, setContactSubject] = useState("");
  const [contactBody, setContactBody] = useState("");

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    // The logout function handles redirection
    setIsLoggingOut(false);
  };

  const handleSubmitContact = async () => {
    if (!contactSubject || !contactBody) {
      toast({
        title: "Missing Information",
        description: "Please provide both a subject and a message.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmittingContact(true);
    const result = await sendContactEmailAction({
      subject: contactSubject,
      body: contactBody,
    });
    setIsSubmittingContact(false);
    if (result.success) {
      toast({
        title: "Message Sent",
        description: "Your message has been sent to the property manager.",
      });
      setIsContactDialogOpen(false);
      setContactSubject("");
      setContactBody("");
    } else {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <header className="bg-primary text-primary-foreground shadow-md sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/portal/dashboard" className="flex items-center gap-3">
            <Image
              src="/images/Nibtera.png"
              alt="NIB Logo"
              width={100}
              height={28}
              className="h-7 w-auto object-contain"
            />
            <span className="hidden sm:inline text-lg font-headline font-semibold">
              NIB Tenant Portal
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-2">
            <Link
              href="/portal/dashboard"
              className="text-sm font-medium hover:underline flex items-center gap-1 p-2 rounded-md hover:bg-primary/80"
            >
              <LayoutDashboard size={18} /> Dashboard
            </Link>
            <Link
              href="/portal/profile"
              className="text-sm font-medium hover:underline flex items-center gap-1 p-2 rounded-md hover:bg-primary/80"
            >
              <User size={18} /> My Account
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsContactDialogOpen(true)}
              className="text-sm font-medium hover:underline flex items-center gap-1 p-2 h-auto text-primary-foreground hover:bg-primary/80"
            >
              <MessageSquare size={18} />
              <span className="ml-1">Contact Manager</span>
            </Button>
            <div className="ml-2">
              <NotificationBell inline label="View Message" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="text-sm font-medium hover:underline flex items-center gap-1 p-2 h-auto text-primary-foreground hover:bg-primary/80"
            >
              {isLoggingOut ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <LogOut size={18} />
              )}
              <span className="ml-1">
                {isLoggingOut ? "Logging out..." : "Logout"}
              </span>
            </Button>
          </nav>

          {/* Mobile Navigation Trigger */}
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[280px] bg-primary text-primary-foreground p-4 flex flex-col"
              >
                <nav className="flex flex-col space-y-2 mt-8 flex-grow">
                  <SheetClose asChild>
                    <Link
                      href="/portal/dashboard"
                      className="text-base font-medium hover:underline flex items-center gap-2 p-2 rounded-md hover:bg-primary/80"
                    >
                      <LayoutDashboard size={20} /> Dashboard
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link
                      href="/portal/profile"
                      className="text-base font-medium hover:underline flex items-center gap-2 p-2 rounded-md hover:bg-primary/80"
                    >
                      <User size={20} /> My Account
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      onClick={() => setIsContactDialogOpen(true)}
                      className="text-base font-medium hover:underline flex items-center justify-start gap-2 p-2 rounded-md hover:bg-primary/80 w-full"
                    >
                      <MessageSquare size={20} />
                      <span className="ml-1">Contact Manager</span>
                    </Button>
                  </SheetClose>
                </nav>
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="text-base font-medium hover:underline flex items-center justify-start gap-2 p-2 rounded-md hover:bg-primary/80 w-full mt-auto"
                  >
                    {isLoggingOut ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <LogOut size={20} />
                    )}
                    <span className="ml-1">
                      {isLoggingOut ? "Logging out..." : "Logout"}
                    </span>
                  </Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Contact Manager Dialog */}
      <Dialog open={isContactDialogOpen} onOpenChange={setIsContactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact Property Manager</DialogTitle>
            <DialogDescription>
              Send a message directly to your building manager.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="Subject"
              value={contactSubject}
              onChange={(e) => setContactSubject(e.target.value)}
              disabled={isSubmittingContact}
            />
            <Textarea
              placeholder="Your message..."
              rows={6}
              value={contactBody}
              onChange={(e) => setContactBody(e.target.value)}
              disabled={isSubmittingContact}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isSubmittingContact}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleSubmitContact}
              disabled={isSubmittingContact || !contactSubject || !contactBody}
            >
              {isSubmittingContact && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
