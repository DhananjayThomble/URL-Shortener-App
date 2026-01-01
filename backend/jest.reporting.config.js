const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  // Enhanced reporting configuration
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './test-results',
        filename: 'report.html',
        expand: true,
        hideIcon: false,
        pageTitle: 'NestJS Backend Test Report',
        logoImgPath: undefined,
        inlineSource: false,
        urlForTestFiles: undefined,
        enableMergeData: true,
        dataMergeLevel: 2,
        includeFailureMsg: true,
        includeSuiteFailure: true,
        includeConsoleLog: true,
        customInfos: [
          {
            title: 'Project Info',
            value: 'NestJS URL Shortener Backend - Comprehensive Test Suite'
          },
          {
            title: 'Test Environment',
            value: process.env.NODE_ENV || 'test'
          },
          {
            title: 'Test Execution Time',
            value: new Date().toISOString()
          }
        ]
      }
    ],
    [
      'jest-junit',
      {
        outputDirectory: './test-results',
        outputName: 'junit.xml',
        ancestorSeparator: ' › ',
        uniqueOutputName: false,
        suiteNameTemplate: '{filepath}',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        includeConsoleOutput: true,
        includeShortConsoleOutput: false,
        addFileAttribute: true
      }
    ]
  ],
  
  // Enhanced coverage configuration
  collectCoverage: true,
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov',
    'json',
    'json-summary',
    'clover'
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/modules/': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/common/': {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  
  // Test result processing
  testResultsProcessor: '<rootDir>/test/utils/test-results-processor.js',
  
  // Enhanced verbose output
  verbose: true,
  
  // Test execution monitoring
  onRunStart: (config, results) => {
    console.log('\n🚀 Starting comprehensive test execution...');
    console.log(`📊 Test suites to run: ${results.numTotalTestSuites}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}\n`);
  },
  
  onRunComplete: (contexts, results) => {
    const { testResults, numTotalTests, numPassedTests, numFailedTests, startTime } = results;
    const duration = Date.now() - startTime;
    
    console.log('\n📈 Test Execution Summary:');
    console.log(`✅ Passed: ${numPassedTests}`);
    console.log(`❌ Failed: ${numFailedTests}`);
    console.log(`📊 Total: ${numTotalTests}`);
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`🏁 Completed at: ${new Date().toISOString()}\n`);
  }
};