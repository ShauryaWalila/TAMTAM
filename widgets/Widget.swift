import WidgetKit
import SwiftUI
import ExpoWidgets

// MARK: - Subviews

struct DrawingWidgetView: View {
    let url: String?
    let family: WidgetFamily
    
    var body: some View {
        ZStack {
            if let urlString = url, let imageUrl = URL(string: urlString), let data = try? Data(contentsOf: imageUrl), let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color.gray.opacity(0.1)
                Text("No drawing yet")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            VStack {
                Spacer()
                HStack {
                    Text("Latest Drawing")
                        .font(.system(size: 10, weight: .bold))
                        .padding(4)
                        .background(.ultraThinMaterial)
                        .cornerRadius(4)
                    Spacer()
                }
                .padding(8)
            }
        }
    }
}

struct TouchWidgetView: View {
    let message: String?
    let timestamp: String?
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "hand.tap.fill")
                .font(.system(size: 30))
                .foregroundColor(.pink)
            
            Text(message ?? "Sent you a touch!")
                .font(.system(size: 14, weight: .medium))
                .multilineTextAlignment(.center)
            
            if let time = timestamp {
                Text(time)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
        .containerBackground(.pink.opacity(0.1), for: .widget)
    }
}

struct DistanceWidgetView: View {
    let distance: String?
    let location: String?
    
    var body: some View {
        let distValue = Double(distance?.replacingOccurrences(of: ",", with: "") ?? "0") ?? 0
        let isTogether = distValue < 1.0
        
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("DISTANCE")
                        .font(.system(size: 8, weight: .black))
                        .foregroundColor(.secondary)
                        .tracking(1)
                    Text(isTogether ? "TOGETHER" : "\(distance ?? "0") km")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(isTogether ? .pink : .primary)
                }
                Spacer()
                Image(systemName: isTogether ? "heart.fill" : "person.2.fill")
                    .font(.system(size: 12))
                    .foregroundColor(isTogether ? .pink : .secondary)
            }
            .padding(.bottom, 8)
            
            ZStack {
                // Background Soft Path
                Path { path in
                    path.move(to: CGPoint(x: 10, y: 30))
                    path.addQuadCurve(to: CGPoint(x: 140, y: 30), control: CGPoint(x: 75, y: 10))
                }
                .stroke(isTogether ? Color.pink.opacity(0.1) : Color.gray.opacity(0.1), lineWidth: 4)
                
                // Pulsing Tether
                Path { path in
                    path.move(to: CGPoint(x: 10, y: 30))
                    path.addQuadCurve(to: CGPoint(x: 140, y: 30), control: CGPoint(x: 75, y: 10))
                }
                .stroke(isTogether ? Color.pink : Color.blue, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [3, 6]))
                
                // Character 1: Home
                VStack(spacing: 2) {
                    ZStack {
                        Circle().fill(.white).frame(width: 28, height: 28).shadow(radius: 1)
                        Text("🏠").font(.system(size: 14))
                    }
                    Text("YOU").font(.system(size: 6, weight: .black)).foregroundColor(.secondary)
                }
                .position(x: 15, y: 30)
                
                // Character 2: Partner (Moves)
                let progress = isTogether ? 0.25 : min(0.9, 1.0 / (log10(max(1.5, distValue))))
                let xPos = 15 + (125 * progress)
                let yPos = 30 - (sin(progress * .pi) * 15) // Move along the arc
                
                VStack(spacing: 2) {
                    ZStack {
                        Circle().fill(isTogether ? .pink : .white).frame(width: 28, height: 28).shadow(radius: 2)
                        Text(isTogether ? "❤️" : "🏃‍♂️").font(.system(size: 14))
                    }
                    Text(isTogether ? "HOME" : "THEM").font(.system(size: 6, weight: .black)).foregroundColor(isTogether ? .pink : .secondary)
                }
                .position(x: xPos, y: yPos)
                
                if isTogether {
                    Text("Safe & Sound")
                        .font(.system(size: 8, weight: .bold, design: .serif))
                        .italic()
                        .foregroundColor(.pink)
                        .offset(y: 25)
                }
            }
            .frame(height: 60)
            
            Spacer()
            
            HStack {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 8))
                Text(isTogether ? "With You" : (location ?? "Searching..."))
                    .font(.system(size: 9, weight: .semibold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(isTogether ? Color.pink.opacity(0.1) : Color.gray.opacity(0.05))
            .cornerRadius(20)
            .foregroundColor(isTogether ? .pink : .secondary)
        }
        .padding()
        .containerBackground(isTogether ? .pink.opacity(0.03) : .clear, for: .widget)
    }
}

struct MeetingWidgetView: View {
    let days: String?
    let title: String?
    
    var body: some View {
        VStack {
            Text(title ?? "Next Meeting")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.secondary)
            
            Spacer()
            
            Text(days ?? "0")
                .font(.system(size: 48, weight: .black))
                .foregroundColor(.orange)
            
            Text("DAYS LEFT")
                .font(.system(size: 10, weight: .black))
                .tracking(2)
            
            Spacer()
        }
        .padding()
        .containerBackground(.orange.opacity(0.05), for: .widget)
    }
}

struct RoutineWidgetView: View {
    let next: String?
    let time: String?
    let itemsJson: String?
    let family: WidgetFamily
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "clock.fill")
                Text("Routine")
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundColor(.indigo)
            
            if family == .systemSmall {
                Spacer()
                Text(next ?? "No activity")
                    .font(.system(size: 16, weight: .bold))
                Text(time ?? "--:--")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                Text("Next Up")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary)
                
                Text("\(next ?? "None") at \(time ?? "--:--")")
                    .font(.system(size: 14, weight: .bold))
                
                Divider()
                
                // Placeholder for list if medium/large
                if family == .systemLarge {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(0..<4) { _ in
                            HStack {
                                Circle().fill(.indigo).frame(width: 6, height: 6)
                                Text("Upcoming Task...")
                                    .font(.system(size: 12))
                                Spacer()
                                Text("12:00")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .containerBackground(.indigo.opacity(0.05), for: .widget)
    }
}

// MARK: - Main Entry View

struct TAMTAMWidgetEntryView : View {
    var entry: ExpoWidgetEntry<WidgetAttributes>
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch entry.attributes.type {
        case "drawing":
            DrawingWidgetView(url: entry.attributes.drawingUrl, family: family)
        case "touch":
            TouchWidgetView(message: entry.attributes.touchMessage, timestamp: entry.attributes.touchTimestamp)
        case "distance":
            DistanceWidgetView(distance: entry.attributes.distanceKm, location: entry.attributes.partnerLocationName)
        case "meeting":
            MeetingWidgetView(days: entry.attributes.daysUntilMeeting, title: entry.attributes.meetingTitle)
        case "routine":
            RoutineWidgetView(next: entry.attributes.nextActivity, time: entry.attributes.nextActivityTime, itemsJson: entry.attributes.routineItemsJson, family: family)
        default:
            VStack {
                Text("TAMTAM")
                    .font(.headline)
                Text("Select a widget type in app settings")
                    .font(.caption)
                    .multilineTextAlignment(.center)
            }
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

struct TAMTAMWidget: Widget {
    let kind: String = "TAMTAMWidget"

    var body: some WidgetConfiguration {
        ExpoWidgetConfiguration(kind: kind, attributes: WidgetAttributes.self) { entry in
            TAMTAMWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("TAMTAM")
        .description("Your shared world on your home screen.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
