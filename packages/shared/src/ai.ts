/**
 * AI tool catalog. The runtime implementation lives in the API; this list is
 * shared so the agent editor can show which tools an agent may use.
 */
export const AI_TOOLS = [
  { name: 'searchProducts', label: 'Search products', description: 'Find products by name, SKU, tag or category.', writes: false },
  { name: 'getProductDetails', label: 'Product details', description: 'Read price, description and attributes of a product.', writes: false },
  { name: 'checkInventory', label: 'Check inventory', description: 'Read available stock for a product.', writes: false },
  { name: 'calculateOrderTotal', label: 'Calculate order total', description: 'Price a cart with tax and shipping.', writes: false },
  { name: 'checkDeliveryAvailability', label: 'Check delivery', description: 'Check whether the business delivers to a city.', writes: false },
  { name: 'getOrderStatus', label: 'Order status', description: "Look up one of the customer's orders.", writes: false },
  { name: 'getCustomerHistory', label: 'Customer history', description: 'Read recent orders and leads of the customer.', writes: false },
  { name: 'createLead', label: 'Create lead', description: 'Record the customer as a sales lead.', writes: true },
  { name: 'updateCustomer', label: 'Update customer', description: 'Save the customer name, email or address.', writes: true },
  { name: 'createOrder', label: 'Create order', description: 'Place an order after the customer confirms.', writes: true },
  { name: 'createTask', label: 'Create task', description: 'Create a follow-up task for the team.', writes: true },
  { name: 'transferToHuman', label: 'Transfer to human', description: 'Hand the conversation over to a human agent.', writes: true },
] as const;

export type AIToolName = (typeof AI_TOOLS)[number]['name'];
export const AI_TOOL_NAMES = AI_TOOLS.map((t) => t.name) as AIToolName[];

export const AI_TONES = ['friendly', 'professional', 'enthusiastic', 'concise', 'empathetic'] as const;
