import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

def calculate_salary_tax(
    gross_salary: float, 
    admissible_deductions: float = 0.0, 
    is_atl_active: bool = True,
    business_gross: float = 0.0,
    property_gross: float = 0.0
) -> Dict[str, Any]:
    """
    Computes statutory income tax liability under the Pakistani Normal Tax Regime (NTR)
    for individual taxpayers, for Tax Year 2027 / Finance Act 2026.

    This implements:
    1. Unified NTR base: Combines Net Salary, Business Income, and Rental Property Income
       (allowing a standard 20% repairs deduction under Section 15).
    2. Regime Determination: Classifies as Salaried if Net Salary exceeds 75% of the total NTR pool;
       otherwise, calculates under Non-Salaried/Business schedules.
    3. Year-end return tax calculation: Identical base tax rate schedules for both filers and non-filers.

    Args:
        gross_salary: Total annual salary income.
        admissible_deductions: Deductions like Zakat allowed directly from salary.
        is_atl_active: Active Taxpayer List status flag.
        business_gross: Total annual gross business income.
        property_gross: Total annual gross property rental income.

    Returns:
        A dictionary containing intermediate calculation values and the final tax owed.
    """
    gross_salary = float(gross_salary)
    admissible_deductions = float(admissible_deductions)
    business_gross = float(business_gross)
    property_gross = float(property_gross)

    taxable_property = property_gross * 0.8 
    taxable_salary = max(0.0, gross_salary - admissible_deductions)
    taxable_ntr = taxable_salary + business_gross + taxable_property
    
    is_salaried = True
    if taxable_ntr > 0:
        is_salaried = (taxable_salary / taxable_ntr) > 0.75

    ntr_base_tax = 0.0
    ntr_variable_rate = 0.0
    ntr_threshold = 0.0
    ntr_slab_name = ""
    ntr_rate_text = ""

    if is_salaried:
        if taxable_ntr <= 600000:
            ntr_slab_name = "Salaried Slab 1 (Up to PKR 600k)"
            ntr_rate_text = "Exempt (0% tax)"
        elif taxable_ntr <= 1200000:
            ntr_slab_name = "Salaried Slab 2 (PKR 600k - 1.2M)"
            ntr_threshold = 600000.0
            ntr_variable_rate = 0.01
            ntr_rate_text = "1% of NTR income > Rs. 600k"
        elif taxable_ntr <= 2200000:
            ntr_slab_name = "Salaried Slab 3 (PKR 1.2M - 2.2M)"
            ntr_base_tax = 6000.0
            ntr_threshold = 1200000.0
            ntr_variable_rate = 0.11
            ntr_rate_text = "Rs. 6,000 + 11% of NTR income > Rs. 1.2M"
        elif taxable_ntr <= 3200000:
            ntr_slab_name = "Salaried Slab 4 (PKR 2.2M - 3.2M)"
            ntr_base_tax = 116000.0
            ntr_threshold = 2200000.0
            ntr_variable_rate = 0.20
            ntr_rate_text = "Rs. 116,000 + 20% of NTR income > Rs. 2.2M"
        elif taxable_ntr <= 4100000:
            ntr_slab_name = "Salaried Slab 5 (PKR 3.2M - 4.1M)"
            ntr_base_tax = 316000.0
            ntr_threshold = 3200000.0
            ntr_variable_rate = 0.25
            ntr_rate_text = "Rs. 316,000 + 25% of NTR income > Rs. 3.2M"
        elif taxable_ntr <= 5600000:
            ntr_slab_name = "Salaried Slab 6 (PKR 4.1M - 5.6M)"
            ntr_base_tax = 541000.0
            ntr_threshold = 4100000.0
            ntr_variable_rate = 0.29
            ntr_rate_text = "Rs. 541,000 + 29% of NTR income > Rs. 4.1M"
        elif taxable_ntr <= 7000000:
            ntr_slab_name = "Salaried Slab 7 (PKR 5.6M - 7.0M)"
            ntr_base_tax = 976000.0
            ntr_threshold = 5600000.0
            ntr_variable_rate = 0.32
            ntr_rate_text = "Rs. 976,000 + 32% of NTR income > Rs. 5.6M"
        else:
            ntr_slab_name = "Salaried Slab 8 (Exceeding PKR 7.0M)"
            ntr_base_tax = 1424000.0
            ntr_threshold = 7000000.0
            ntr_variable_rate = 0.35
            ntr_rate_text = "Rs. 1,424,000 + 35% of NTR income > Rs. 7.0M"
    else:
        if taxable_ntr <= 600000:
            ntr_slab_name = "Business Slab 1 (Up to PKR 600k)"
            ntr_rate_text = "Exempt (0% tax)"
        elif taxable_ntr <= 1200000:
            ntr_slab_name = "Business Slab 2 (PKR 600k - 1.2M)"
            ntr_threshold = 600000.0
            ntr_variable_rate = 0.075
            ntr_rate_text = "7.5% of NTR income > Rs. 600k"
        elif taxable_ntr <= 2400000:
            ntr_slab_name = "Business Slab 3 (PKR 1.2M - 2.4M)"
            ntr_base_tax = 45000.0
            ntr_threshold = 1200000.0
            ntr_variable_rate = 0.15
            ntr_rate_text = "Rs. 45,000 + 15% of NTR income > Rs. 1.2M"
        elif taxable_ntr <= 3000000:
            ntr_slab_name = "Business Slab 4 (PKR 2.4M - 3.0M)"
            ntr_base_tax = 225000.0
            ntr_threshold = 2400000.0
            ntr_variable_rate = 0.20
            ntr_rate_text = "Rs. 225,000 + 20% of NTR income > Rs. 2.4M"
        elif taxable_ntr <= 4000000:
            ntr_slab_name = "Business Slab 5 (PKR 3.0M - 4.0M)"
            ntr_base_tax = 345000.0
            ntr_threshold = 3000000.0
            ntr_variable_rate = 0.25
            ntr_rate_text = "Rs. 345,000 + 25% of NTR income > Rs. 3.0M"
        elif taxable_ntr <= 6000000:
            ntr_slab_name = "Business Slab 6 (PKR 4.0M - 6.0M)"
            ntr_base_tax = 595000.0
            ntr_threshold = 4000000.0
            ntr_variable_rate = 0.30
            ntr_rate_text = "Rs. 595,000 + 30% of NTR income > Rs. 4.0M"
        else:
            ntr_slab_name = "Business Slab 7 (Exceeding PKR 6.0M)"
            ntr_base_tax = 1195000.0
            ntr_threshold = 6000000.0
            ntr_variable_rate = 0.35
            ntr_rate_text = "Rs. 1,195,000 + 35% of NTR income > Rs. 6.0M"

    ntr_excess = max(0.0, taxable_ntr - ntr_threshold)
    standard_tax = ntr_base_tax + (ntr_excess * ntr_variable_rate)
    final_tax = standard_tax
    
    total_gross = gross_salary + business_gross + property_gross
    effective_rate = (final_tax / total_gross * 100.0) if total_gross > 0 else 0.0

    return {
        "gross_salary": gross_salary,
        "admissible_deductions": admissible_deductions,
        "taxable_income": taxable_ntr,
        "salary_income": gross_salary,
        "business_income": business_gross,
        "rental_income": property_gross,
        "is_salaried_regime": is_salaried,
        "slab_name": ntr_slab_name or "Exempt",
        "rate_description": ntr_rate_text or "No declared taxable income sources.",
        "base_tax": ntr_base_tax,
        "variable_rate": ntr_variable_rate,
        "variable_tax": ntr_excess * ntr_variable_rate,
        "total_tax_owed": final_tax,
        "effective_rate": f"{effective_rate:.2f}%"
    }
