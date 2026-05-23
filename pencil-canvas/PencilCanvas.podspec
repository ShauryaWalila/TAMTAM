Pod::Spec.new do |s|
  s.name             = "PencilCanvas"
  s.version          = "1.0.0"
  s.summary          = "Local React Native wrapper around UIKit PKCanvasView (Apple PencilKit)."
  s.description      = "Owned in-repo. No third-party Swift code. Provides a single RN view component plus imperative methods (clear/undo/redo/getBase64/loadBase64/getPng)."
  s.homepage         = "https://example.com/tamtam-pencil-canvas"
  s.license          = { :type => "MIT" }
  s.author           = { "TAMTAM" => "noreply@example.com" }
  s.platforms        = { :ios => "13.4" }
  s.source           = { :path => "." }
  s.source_files     = "**/*.{h,m,mm}"
  s.requires_arc     = true
  s.frameworks       = "UIKit", "PencilKit", "Foundation"

  # New-arch projects (RN >= 0.71) use install_modules_dependencies to wire
  # React-Core + codegen automatically. Older projects fall back to
  # an explicit React-Core dependency.
  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
