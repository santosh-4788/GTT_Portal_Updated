# The mobile apps

Two Android apps are built from this project, plus a way to get both onto an
iPhone without a Mac or an Apple account.

| App | For | File | Build with |
|---|---|---|---|
| **GTT Portal** | admin & billing staff | `dist\GTT-Portal.apk` | `scripts\build-apk.bat` |
| **Gupta Tours** | customers | `dist\GTT-Customer.apk` | `scripts\build-customer-apk.bat` |

They are separate apps with separate ids (`com.guptatours.portal` and
`com.guptatours.customer`), so both can be installed on the same phone — which
the owner will want.

Sections 1–9 below are about the **staff** app. The customer app is §10, how
both apps move is §11, and iPhone is §12.

---

## 1. What it is

The app is the portal's own admin screens wrapped in an Android shell. It is not
a separate product and it has no database of its own — it talks to the same API
the website does, so anything done in the app is immediately visible in the
browser and the other way round.

Because it is the same screens, every fix to the portal reaches the app the next
time it is rebuilt. Nothing has to be written twice.

**It costs nothing to build or run.** The toolchain — JDK, Android SDK, Gradle,
Capacitor — is free and open source, and no Google Play developer account is
needed because the APK is installed by hand rather than published. That matches
the rest of the portal, which uses no paid service anywhere.

**What is different on the phone:**

- Navigation is a row of tabs along the bottom instead of the sidebar.
- The four tabs are chosen by role. Billing staff get Dashboard, Billing,
  Invoices and Payments. Admins get Dashboard, Trips, Bookings and Billing.
  Everything else either role can reach is under **More**.
- Downloads (invoices, reports, rate-card templates) open Android's share
  sheet, so a file can be opened in a PDF viewer, saved to Downloads, or sent
  straight to the vendor on WhatsApp or email.

## 2. Who can sign in

| Role | In the app? |
|---|---|
| Super Admin | Yes |
| Admin | Yes |
| Billing User | Yes |
| Operations User | No |
| View Only | No |

Operations and view-only staff are told to use a browser instead. Their work is
booking entry, which is a poor fit for a phone.

Within the app, a role sees exactly what it sees on the website — Billing has no
Settings, Users or Audit Log, because the role does not hold those permissions.
This is enforced by the API, not by the app.

## 3. Installing it

1. Copy `dist\GTT-Portal.apk` to the phone — USB cable, email, or WhatsApp to
   yourself, whichever is easiest.
2. Open the file on the phone.
3. Android will say the app is from an unknown source. Allow it for the app you
   are installing from (usually Files or Chrome), then open the APK again.
4. Install, and open **GTT Portal**.

The APK is debug-signed. That is fine for installing by hand and is the reason
Android asks for permission. It cannot be published to the Play Store as-is.

## 4. Pointing it at the portal

The first screen asks for the **portal address**. This is the single thing that
has to be right, and it can be changed at any time from **More → Portal
address** — no rebuild needed.

The address is wherever the portal answers from. It is a **web address** — the
same one the portal opens on in a browser — not a name of any kind.

- **On the same Wi-Fi:** `http://<the PC's address>:4100`, for example
  `http://172.23.38.226:4100`. Works only while the phone is on the same network
  as the PC, and the PC is running.
- **Over the internet:** the public https address (see below). Works anywhere,
  on mobile data.

> The `http://` on a LAN address matters. The portal on the office network does
> not use TLS, so `https://` to it can never connect.

### Finding the PC's address

It changes whenever the PC joins a different network, so check it rather than
remembering it. In PowerShell on the portal PC:

```
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object IPAddress, InterfaceAlias
```

Use the one whose interface is actually connected — `Get-NetConnectionProfile`
shows which. Ignore any `vEthernet` entry; that is a virtual adapter and no
phone can reach it.

Tap **Test** before saving. It checks the address really is the portal and says
so, which is much easier than discovering a typo later as a failed sign-in.

### Making the portal reachable from outside the office

The portal runs on this PC and is not on the internet by default. To reach it
from a phone on mobile data, open a tunnel:

```
ngrok http 4100
```

ngrok prints an address like `https://something.ngrok-free.app`. Put that into
the app's portal address screen.

This is the free tier and costs nothing. The one thing to know about it: **the
address changes every time ngrok restarts**, so when it does, each phone needs
the new one entering under **More → Portal address**. That screen exists for
exactly this reason — it takes a few seconds and needs no rebuild.

Two habits make that a non-issue:

- **Leave ngrok running.** The address only changes on restart, not over time.
  Started once in the morning, it lasts the day.
- **On the office Wi-Fi, do not use a tunnel at all.** The LAN address above is
  faster, needs no third party, and never changes while the PC stays on the
  same network.

> Nothing in this portal uses a paid service, and nothing here needs one. Paid
> tunnel plans exist and would hand out one fixed address, but the free tier
> plus the in-app address screen does the same job — so that is what this is
> built around.

## 5. Rebuilding the app

After any change to the portal's screens:

```
scripts\build-apk.bat
```

That rebuilds the web bundle, copies it into the Android project, builds the
APK, and leaves it at `dist\GTT-Portal.apk`. The first run downloads Gradle and
takes several minutes; later runs are about a minute.

## 6. Setting a default address

The app can ship already pointing somewhere, so staff never see the address
screen on first launch. Create `frontend\.env.production.local`:

```
VITE_SERVER_URL=http://192.168.0.10:4100
```

Then rebuild. It is only a default — anyone can still change it from
**More → Portal address**, and the saved value wins from then on.

The sensible thing to put here is **the PC's LAN address**, since most use is on
the office Wi-Fi and that address is stable as long as the PC stays on the same
network. Staff only touch the address screen on the days they are out and need
the tunnel.

Re-check the LAN address (see §4) before compiling it in — it changes if the PC
joins a different network, and a stale default is worse than none.

## 7. Where the build tools live

Installed outside the usual locations because the C: drive on this machine has
very little space free:

| | |
|---|---|
| JDK 17 | `E:\AndroidBuild\jdk` |
| Android SDK | `E:\AndroidBuild\sdk` |
| Gradle cache | `E:\AndroidBuild\gradle` |

`scripts\build-apk.bat` sets all three; nothing needs to be on the system PATH
and no environment variables need changing. Android Studio is not required.

The SDK path is also written in `frontend\android\local.properties`. That file
is specific to this machine and should not be copied to another one.

## 8. Things worth knowing

- **The app needs the portal running.** It is a window onto this PC's server,
  not a copy of it. If the PC is off, the app cannot load anything.
- **There is no offline mode.** Every screen is fetched live.
- **Sessions last 8 hours** (`JWT_EXPIRES_IN` in `backend\.env`), after which
  the app returns to sign-in.
- **`https://localhost` must stay in `CORS_ORIGINS`** in `backend\.env`. That is
  the origin the app's WebView reports, and the API refuses requests from
  origins it does not know. Removing it stops the app signing in.
- **The app allows plain `http://` addresses** so the office LAN fallback works.
  Prefer the https address when the phone is off the office network.

## 9. Changing the app's name or icon

| What | Where |
|---|---|
| Name under the icon | `frontend\android\app\src\main\res\values\strings.xml` |
| Icon artwork | `frontend\android\app\src\main\res\drawable-nodpi\gtt_logo.png` |
| Icon background | `frontend\android\app\src\main\res\values\ic_launcher_background.xml` |
| Version number | `versionName` in `frontend\android\app\build.gradle` |

Rebuild after any of these.

## 10. The customer app

**`dist\GTT-Customer.apk`** — build with `scripts\build-customer-apk.bat`.

What a customer gets, as four tabs:

| Tab | What it is |
|---|---|
| **Book** | The booking form — local, airport, outstation, hourly |
| **My Trips** | Every trip they have asked for, from enquiry to invoice |
| **Track** | Look a trip up by its Trip ID |
| **Profile** | Their details, and their GST details for invoices |

**The app opens on sign-in, not on the booking form.** Nothing inside is
reachable until the customer has an account and is signed in. It is a
**customer** account (the same `/account` sign-in as the website), never a staff
one — the two are different accounts in different tables and always have been.

Somebody who taps a link to a trip while signed out is sent to sign-in and then
on to that trip, rather than being dumped at the front. The portal-address
screen stays reachable signed out, because a wrong address is one of the reasons
sign-in itself would fail.

> The website still lets anyone enquire without an account. Only the app
> requires one, which is the difference between a shop window and a set of keys.

**It cannot reach the portal.** The customer bundle contains no admin screen and
mounts no staff session — there is no route to one and no token for one. That is
a property of what is in the bundle, not a permission check that could be got
around.

Marketing pages are deliberately left out. Somebody who has installed the app has
already chosen the company, so the wedding planner and the service brochures stay
on the website.

### Giving it to customers

Put the APK somewhere they can download it — the website, an email, a WhatsApp
message. Android will warn that it is from an unknown source, which is normal
for any app outside the Play Store. It is the same debug signing as the staff
app.

The customer's phone needs to reach the portal, so the same address rules apply
as §4: a customer on mobile data needs the tunnel address, not the LAN one.

## 11. How the apps feel

Both apps move the way a phone app is expected to, and the rule behind it is the
one iOS follows: **the direction of the movement tells you where you are.**

| Doing this | Looks like |
|---|---|
| Tapping a different tab | a cross-fade — tabs are peers, not a stack |
| Opening a trip, an invoice, a vendor | the new screen slides in from the right |
| Going back | the previous screen slides back in from the left |
| Opening the menu sheet | slides up from the bottom, with the backdrop fading in |
| Pressing a tab or a card | a quick scale-down, under 120ms |

Everything animated is **transform and opacity only**. Both are handled by the
phone's compositor, so none of it forces a layout or paint and none of it
competes with React for the main thread — which is the difference between smooth
on a mid-range Android phone and smooth only on a developer's desktop.

A phone set to **Reduce Motion** gets none of it; that is handled once, for the
whole app, at the foot of `frontend/src/index.css`.

## 12. iPhone

**A native iOS app cannot be built from this project on this machine, and not
for a reason that can be worked around here.**

- Apple's toolchain (Xcode) runs **only on macOS**. There is no supported way to
  compile or sign an iOS app on Windows.
- Even with a Mac, putting an app on a colleague's iPhone for longer than 7 days
  needs the **Apple Developer Program at $99/year** — a paid service, which this
  project does not use anywhere.

So the app store route is closed. What is open, and costs nothing:

### Add to Home Screen

On the iPhone, in **Safari** (not Chrome — only Safari can install):

1. Open the portal address.
2. Tap **Share**, then **Add to Home Screen**.
3. Name it and tap **Add**.

The result is an icon on the home screen that opens full-screen with no browser
bars. For a tool that is a live window onto a server, that is the same thing the
Android app is.

**Two separate icons are possible**, because the site serves two manifests:

| Add to Home Screen from | You get |
|---|---|
| the site's home page | **Gupta Tours** — opens at the booking screen |
| any `/admin` page | **GTT Portal** — opens straight at the portal |

Staff open the portal first, then add it, and the icon lands on the portal
rather than the public site.

### What the iPhone version does not have

- **No share sheet for downloads.** Invoices open in Safari's own viewer rather
  than Android's share sheet. They can still be saved to Files from there.
- **No push notifications** unless the phone is on iOS 16.4 or newer, and even
  then only once it has been added to the home screen.
- **Safari can evict its storage** if the phone runs very low on space, which
  signs the user out. Signing back in restores everything; nothing is lost,
  because the app holds no data of its own.

None of that affects the main job — booking, checking a trip, raising an
invoice — which all happen on the server.
