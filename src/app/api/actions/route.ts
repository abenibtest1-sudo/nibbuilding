// import { NextResponse, type NextRequest } from "next/server";
// import {
//   verifySession,
//   CSRF_TOKEN_COOKIE_NAME,
//   CSRF_TOKEN_SIG_NAME,
//   signCsrfToken,
//   verifyCsrfToken,
//   LAST_ACTIVE_COOKIE_NAME,
//   IDLE_TIMEOUT_MS,
//   getSessionCookieNames,
//   ACCESS_TOKEN_COOKIE_NAME,
// } from "@/lib/auth/jwt";
// import { PERMISSION_MAP } from "@/lib/auth-utils";
// import { nanoid } from "nanoid";

// const ORDERED_ADMIN_PAGES = [
//   "/admin/dashboard",
//   "/admin/buildings",
//   "/admin/spaces",
//   "/admin/tenants",
//   "/admin/agreements",
//   "/admin/billing",
//   "/admin/payments-overview",
//   "/admin/building-utilities",
//   "/admin/audit-log",
//   // Settings sub-pages (so users with only Settings permissions can land somewhere valid)
//   "/admin/settings/bill-date-configuration",
//   "/admin/settings/agreement-template",
//   "/admin/settings/role-management",
//   "/admin/settings/user-management",
//   "/admin/settings/user-registration",
//   "/admin/import",
// ];

// const PUBLIC_ROUTES = [
//   "/login",
//   "/portal/connect",
//   "/portal/cancel",
//   "/portal/error",
//   "/api/portal/payment-callback",
// ];
// export async function middleware(request: NextRequest) {
//   const { pathname } = request.nextUrl;

//   let response = NextResponse.next();

//   // --- CSRF Token Generation ---
//   const csrfToken = request.cookies.get(CSRF_TOKEN_COOKIE_NAME)?.value;
//   const csrfSig = request.cookies.get(CSRF_TOKEN_SIG_NAME)?.value;
//   if (!csrfToken || !csrfSig || !(await verifyCsrfToken(csrfToken, csrfSig))) {
//     const tokenValue = nanoid(32);
//     const sigValue = await signCsrfToken(tokenValue);
//     response.cookies.set(CSRF_TOKEN_COOKIE_NAME, tokenValue, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === "production",
//       path: "/",
//       sameSite: "lax",
//     });
//     response.cookies.set(CSRF_TOKEN_SIG_NAME, sigValue, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === "production",
//       path: "/",
//       sameSite: "lax",
//     });
//   }
//   // --- End CSRF Token Generation ---

//   // Public files, such as images, should be ignored.
//   if (pathname.includes(".") && !pathname.startsWith("/api")) {
//     return response;
//   }

//   const isPublicRoute =
//     PUBLIC_ROUTES.some((path) => pathname.startsWith(path)) || pathname === "/";
//   const isApiAuthRoute = pathname.startsWith("/api/auth");

//   // Let public routes and API auth routes pass through without a session check.
//   if (isPublicRoute || isApiAuthRoute) {
//     return response;
//   }

//   // Verify session for all other routes
//   const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
//   const session = await verifySession(accessToken);

//   if (!session) {
//     // For API protected routes, return 401 so clients can handle logout
//     return NextResponse.json(
//       { message: "Unauthorized. Please log in." },
//       { status: 401 },
//     );
//   }

//   // Idle timeout enforcement for API/actions middleware
//   try {
//     const lastActive = request.cookies.get(LAST_ACTIVE_COOKIE_NAME)?.value;
//     const now = Date.now();
//     if (!lastActive || now - Number(lastActive) > IDLE_TIMEOUT_MS) {
//       const resp = NextResponse.json(
//         { message: "Session expired due to inactivity." },
//         { status: 401 },
//       );
//       const cookieNames = getSessionCookieNames();
//       cookieNames.forEach((name) =>
//         resp.cookies.set(name, "", { expires: new Date(0), path: "/" }),
//       );
//       return resp;
//     }

//     // Update last-active cookie
//     response.cookies.set(LAST_ACTIVE_COOKIE_NAME, String(now), {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === "production",
//       path: "/",
//       sameSite: "lax",
//     });
//   } catch (err) {
//     // ignore errors reading/updating the cookie
//   }

//   // --- If session exists ---

//   // Handle forced password change
//   if (
//     session.forceChangePass &&
//     !pathname.startsWith("/portal/change-password")
//   ) {
//     return NextResponse.redirect(
//       new URL("/portal/change-password", request.url),
//     );
//   }
//   if (
//     !session.forceChangePass &&
//     pathname.startsWith("/portal/change-password")
//   ) {
//     return NextResponse.redirect(new URL("/portal/dashboard", request.url));
//   }

//   const userPermissions = new Set(session.permissions);
//   const isTenantOnly =
//     userPermissions.has("portal:view") &&
//     userPermissions.size === 1 &&
//     !session.isSuperAdmin;

//   // Handle role-based authorization for admin routes
//   if (pathname.startsWith("/admin")) {
//     if (isTenantOnly) {
//       return NextResponse.redirect(new URL("/portal/dashboard", request.url));
//     }

//     if (session.isSuperAdmin) {
//       return response;
//     }

//     const requiredPermission = Object.entries(PERMISSION_MAP).find(
//       ([pathPrefix]) => pathname.startsWith(pathPrefix),
//     )?.[1];

//     if (requiredPermission && !userPermissions.has(requiredPermission)) {
//       const firstAllowedPage = ORDERED_ADMIN_PAGES.find((page) => {
//         const permission = PERMISSION_MAP[page];
//         return permission && userPermissions.has(permission);
//       });

//       const redirectUrl = new URL(firstAllowedPage || "/login", request.url);
//       // Only show an error when the user has *no* allowed landing page.
//       // If we can redirect them to a permitted page (Settings/Import/Audit/etc),
//       // do it silently to avoid misleading "Access Denied" banners.
//       if (!firstAllowedPage) {
//         redirectUrl.searchParams.set("error", "Access Denied");
//       }
//       return NextResponse.redirect(redirectUrl);
//     }
//   }

//   // Handle role-based authorization for portal routes
//   if (pathname.startsWith("/portal/") && !isPublicRoute) {
//     if (!isTenantOnly) {
//       // Any user who is NOT a tenant (e.g., an admin) trying to access the tenant portal is redirected.
//       return NextResponse.redirect(new URL("/admin/dashboard", request.url));
//     }
//   }

//   // If all checks pass, allow the request
//   return response;
// }

// export const config = {
//   matcher: ["/((?!_next/static|_next/image|favicon.ico|images).*)"],
// };
