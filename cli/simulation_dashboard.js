#!/usr/bin/env node

/**
 * @fileoverview Simulation Dashboard CLI
 * Comprehensive monitoring and management tool for simulations
 * 
 * Usage:
 *   node simulation_dashboard.js [command] [options]
 */

import chalk from 'chalk';
import { DashboardCore } from './dashboard/core.js';
import { DashboardMetrics } from './dashboard/metrics.js';
import { DashboardMenu } from './dashboard/menu.js';
import { DashboardOperations } from './dashboard/operations.js';

class SimulationDashboard {
    constructor() {
        this.core = new DashboardCore();
        this.metrics = null;
        this.menu = null;
        this.operations = null;
    }

    async initialize() {
        await this.core.initialize();
        this.metrics = new DashboardMetrics(this.core);
        this.menu = new DashboardMenu(this.core);
        this.operations = new DashboardOperations(this.core, this.menu);
    }

    /**
     * Main dashboard view
     */
    async showDashboard() {
        console.clear();
        console.log(chalk.blue.bold('🎯 SIMULATION DASHBOARD'));
        console.log('='.repeat(60));
        
        // Show key metrics
        await this.metrics.showKeyMetrics();
        
        // Show recent simulations
        await this.metrics.showRecentSimulations();
        
        // Show menu and handle interactions
        await this.handleMainMenu();
    }

    /**
     * Handle main menu interactions
     */
    async handleMainMenu() {
        while (true) {
            const choice = await this.menu.showMainMenu();
            
            switch (choice) {
                case '1':
                    await this.operations.runNewSimulation();
                    break;
                case '2':
                    await this.operations.viewSimulationDetails();
                    break;
                case '3':
                    await this.operations.analyzePerformance();
                    break;
                case '4':
                    await this.operations.manageScenarios();
                    break;
                case '5':
                    await this.operations.viewFeedback();
                    break;
                case '6':
                    await this.operations.batchOperations();
                    break;
                case '7':
                    await this.operations.systemStatus();
                    break;
                case '8':
                    await this.showDashboard();
                    return; // Refresh dashboard
                case '9':
                    console.log(chalk.green('\n👋 Goodbye!'));
                    return;
                default:
                    console.log(chalk.red('\n❌ Invalid option. Please try again.'));
                    await this.menu.pause();
                    continue;
            }
            
            // Return to dashboard after each operation
            await this.showDashboard();
        }
    }

    cleanup() {
        this.core.cleanup();
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🎯 Simulation Dashboard CLI

Usage:
  node simulation_dashboard.js [options]

Options:
  --help, -h        Show this help message

Features:
  - Real-time simulation monitoring
  - Performance analysis and trends
  - Scenario management and testing
  - Feedback collection and analysis
  - Batch operations and reporting
  - System status monitoring

Examples:
  node simulation_dashboard.js                    # Launch interactive dashboard
        `);
        process.exit(0);
    }

    console.log('🎯 Starting Simulation Dashboard...');
    const dashboard = new SimulationDashboard();
    
    try {
        console.log('📊 Initializing dashboard...');
        await dashboard.initialize();
        console.log('✅ Dashboard initialized successfully');
        console.log('🚀 Launching interactive dashboard...');
        await dashboard.showDashboard();
    } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
        console.error(error.stack);
    } finally {
        console.log('🧹 Cleaning up dashboard...');
        dashboard.cleanup();
    }
}

// Run if called directly
main().catch(console.error);
