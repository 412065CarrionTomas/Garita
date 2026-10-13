require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'GaritaNative'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = 'UNLICENSED'
  s.author = 'Garita'
  s.homepage = 'https://github.com/412065CarrionTomas/Garita'
  s.source = { :git => 'https://github.com/412065CarrionTomas/Garita.git', :tag => s.version.to_s }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
end
