require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Linked by .github/workflows/ios-build.yml (its Podfile lists pods by hand).
Pod::Spec.new do |s|
  s.name = 'JfPhotos'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary', :text => 'JF Effect. All rights reserved.' }
  s.homepage = 'https://jfeffect.com'
  s.author = package['author']
  s.source = { :git => 'https://github.com/jared-james-fit/jfeffect-command-center.git', :tag => "jf-photos-#{package['version']}" }
  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '16.0'
  s.frameworks = 'Photos', 'UIKit', 'AVFoundation'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
