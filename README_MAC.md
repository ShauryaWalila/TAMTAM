# Complete Mac Setup & Deployment Guide

This guide is for setting up a **completely fresh Mac** from scratch to build the TAMTAM app. Follow these steps in order.

## Part 1: Install Required Tools

Open the **Terminal** app on your Mac (press `Command + Space` and type "Terminal").

1. **Install Homebrew** (Package Manager)
   Paste this into Terminal and press Enter:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   *Follow the instructions at the end of the install to "Add Homebrew to your PATH".*

2. **Install Node.js & Watchman**
   Run this in Terminal:
   ```bash
   brew install node watchman
   ```

3. **Install Xcode** (The official Apple tool)
   - Open the **App Store** on your Mac.
   - Search for **Xcode** and download it.
   - Once downloaded, open Xcode once to accept the license agreement and let it install "Additional Components".

4. **Install CocoaPods** (Required for iOS libraries)
   Run this in Terminal:
   ```bash
   sudo gem install cocoapods
   ```

---

## Part 2: Prepare the App

1. **Install Dependencies**
   Navigate to the project folder in Terminal (e.g., `cd path/to/TAMTAM`) and run:
   ```bash
   npm install
   ```

2. **Generate iOS Project**
   Run this to create the `ios` folder:
   ```bash
   npx expo prebuild
   ```

---

## Part 3: Build in Xcode

1. **Open the Project**
   Open the generated workspace file:
   `ios/TAMTAM.xcworkspace`

2. **Configure App Groups**
   - In Xcode, select the blue **TAMTAM** folder icon at the top of the left sidebar.
   - Select the main **TAMTAM** target under "Targets".
   - Go to the **Signing & Capabilities** tab.
   - Click **+ Capability** (top left) and search for **App Groups**.
   - Click the **+** button inside the App Groups section and add this exact ID: 
     `group.com.pratishth.ourlink`
   - **Repeat** this for the **TAMTAMWidget** target if it exists in the list.

3. **Archive & Export**
   - Set the build destination (top middle of Xcode) to **Any iOS Device (arm64)**.
   - Go to the top menu: **Product > Archive**.
   - Wait for the build to finish. A window will pop up.
   - Click **Distribute App**.
   - Select **Development** and export the IPA using your Apple ID.

---
*If you run into "Permission Denied" errors in Terminal, prefix the command with `sudo`.*

## Part 4: Cleanup & Reclaim Space

Since this Mac is low on space, run these steps after you have successfully exported your IPA.

1. **Delete Build Folders** (Free up ~2GB)
   In the project folder Terminal, run:
   ```bash
   rm -rf ios node_modules
   ```

2. **Clear Xcode Cache** (Critical: Free up 5GB - 20GB+)
   Xcode stores massive amounts of temporary data. Run this:
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData/*
   ```

3. **Uninstall Tools**
   Run these one by one to remove the installed software:
   ```bash
   # Remove CocoaPods
   sudo gem uninstall cocoapods
   
   # Remove Node and Watchman
   brew uninstall node watchman
   
   # Final Wipe: Remove Homebrew itself (Optional, but reclaims most space)
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"
   ```

4. **Delete Xcode**
   - Open **Finder > Applications**.
   - Drag **Xcode** to the Trash.
   - Right-click Trash and select **Empty Trash**.
